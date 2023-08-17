const openAIApiKey = Deno.env.get("OPENAI_API_KEY");

const systemPrompt = `Tu incarnes Jocelyne, notre réceptionniste virtuelle. Tu dois rediriger les demandes aux bonnes personnes selon la discussion.

Voici les services que nous offront :

# Registraire
Service : admission, inscription, reconnaissance des acquis
Contact : Chantal notre experte au poste 8982

# Services aux étudiants 
Service : inscription, confort et plaisir d'étudier à l'université
Contact : Pierre notre conseiller au poste 8743`;

const textEncoder = new TextEncoder();

const kv = await Deno.openKv();

type Message = { role: string; content: string; };

const server = Deno.serve(
	{
		port: 8080
	},
	async (req, info) => {
		const sessionId = req.headers.get("X-DISCUSSION-ID") ?? crypto.randomUUID();
		const history: Message[] = [];
		for await (const message of await kv.list<Message>({ prefix: ["discussion", sessionId] })) {
			history.push(message.value);
		}
		if (history.length == 0) {
			const systemMessage = { role: "system", content: systemPrompt };
			await kv.set(["discussion", sessionId, Date.now()], systemMessage);
			history.push(systemMessage);
		}
		const message = { role: 'user', content: await req.text() };
		await kv.set(["discussion", sessionId, Date.now()], message);
		history.push(message);

		console.log('History', history);


		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${openAIApiKey}`,
			},
			body: JSON.stringify({
				model: "gpt-3.5-turbo",
				temperature: 0,
				stream: true,
				functions: [
					{
						name: "forget_conversation",
						description: "Oublier la conversation, effacer la conversation, efface mes données",
						parameters: { type: "object", properties: { dummy: { type: "null" } } }
					}
				],
				messages: [...history],
			}),
		});

		const parser = parseOpenAIChatCompletionsStream(response.body!);
		let assistantResponse = '';

		return new Response(new ReadableStream({
			async pull(controller) {
				const chunk = await parser.next();
				if (chunk.done) {
					if (assistantResponse) {
						await kv.set(["discussion", sessionId, Date.now()], { role: 'assistant', content: assistantResponse });
					}
					controller.enqueue(textEncoder.encode(`\n`));
					controller.close();
				} else {
					if (chunk.value.type === "chunk") {
						assistantResponse += chunk.value.content;
						controller.enqueue(textEncoder.encode(chunk.value.content));
					} else if (chunk.value.type === "function_call") {
						if (chunk.value.name === "forget_conversation") {
							controller.enqueue(textEncoder.encode("Tout est oublié."));
							for await (const message of await kv.list({ prefix: ["discussion", sessionId] })) {
								await kv.delete(message.key);
							}
							await kv.set(["discussion", sessionId, Date.now()], { role: "system", content: systemPrompt });
						}
					} else {
						controller.enqueue(new Uint8Array())
					}
				}
			}
		}), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
	}
);

await server.finished;

type OpenAIChatCompletionChunk =
	| { type: "chunk"; content: string }
	| { type: "function_call"; name: string; arguments: unknown }

async function* parseOpenAIChatCompletionsStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<OpenAIChatCompletionChunk, void> {
	const textDecoder = new TextDecoder();
	const reader = stream.getReader();
	try {
		let rest = '';
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			const chunk = rest + textDecoder.decode(value);
			let idx = 0;
			for (const match of chunk.matchAll(/data: ([^\n]+)\n\n/g)) {
				idx += match[0].length;
				if (match[1] === "[DONE]") return;
				try {
					const json = JSON.parse(match[1]) as unknown;
					if (json && typeof json === "object" && "object" in json && "choices" in json && Array.isArray(json.choices)) {
						const choice = json.choices[0] as { index: number; finish_reason: null | string; delta: { content: string; role?: string; function_call?: { name: string; arguments: unknown } } };
						if (choice.finish_reason) {
							//yield { type: "stop" };
						} else if (choice.delta.function_call) {
							if (choice.delta.function_call.name) {
								yield { type: "function_call", name: choice.delta.function_call.name, arguments: choice.delta.function_call.arguments };
							}
						} else {
							yield { type: "chunk", content: choice.delta.content };
						}
					}
				} catch (error) {
					console.error(error);
				}
			}
			rest = chunk.slice(idx);
		}
	} finally {
		reader.releaseLock();
	}
}