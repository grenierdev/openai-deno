const openAIApiKey = Deno.env.get("OPENAI_API_KEY");

async function* streamAsyncIterable(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

console.time("request time");
const response = await fetch("https://api.openai.com/v1/chat/completions", {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"Authorization": `Bearer ${openAIApiKey}`,
	},
	body: JSON.stringify({
		model: "gpt-3.5-turbo",
		temperature: 0.9,
		stream: true,
		messages: [
			{ role: "system", content: `You are a helpful assistance.` },
			{ role: "assistant", content: `How may I help you today?` },
			{
				role: "user",
				content:
					`Can you suggest me a title for an article about good fishing spot in Rouyn-Noranda? I only one the best suggestion you got.`,
			},
			{
				role: "assistant",
				content:
					`Sure, here's a suggestion: "Reeling in the Best Catches: Exploring the Top Fishing Spots in Rouyn-Noranda".`,
			},
			{
				role: "user",
				content: `Write me an intro for that article, in french.`,
			},
		],
	}),
});
console.timeEnd("request time");
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const dataLineRegEx = /data: (.+)\n/g;
for await (const chunk of streamAsyncIterable(response.body!)) {
	const message = textDecoder.decode(chunk);
	try {
		let match: RegExpExecArray | null = null;
		while ((match = dataLineRegEx.exec(message))) {
			const message = match[1];
			if (message === "[DONE]") break;
			const json = JSON.parse(message);
			await Deno.stdout.write(textEncoder.encode(json?.choices?.[0]?.delta.content));
		}
	} catch (error) {
		console.log();
		console.error(error);
		console.log(message);
		break;
	}
}
console.log();

// console.time("chat");
// const response = await fetch("https://api.openai.com/v1/chat/completions", {
// 	method: "POST",
// 	headers: {
// 		"Content-Type": "application/json",
// 		"Authorization": `Bearer ${openAIApiKey}`
// 	},
// 	body: JSON.stringify({
// 		model: "gpt-3.5-turbo",
// 		temperature: 0.9,
// 		messages: [
// 			{ role: "system", content: `You are a helpful assistance.` },
// 			{ role: "assistant", content: `How may I help you today?` },
// 			{ role: "user", content: `Can you suggest me a title for an article about good fishing spot in Rouyn-Noranda? I only one the best suggestion you got.` },
// 			{ role: "assistant", content: `Sure, here's a suggestion: "Reeling in the Best Catches: Exploring the Top Fishing Spots in Rouyn-Noranda".` },
// 			{ role: "user", content: `Write me an intro for that article, in french.` }
// 		]
// 	})
// });
// const json = await response.json();
// console.timeEnd("chat");
// console.log(json);
// console.log(json?.choices?.[0]?.message.content);

// import { ChatOpenAI } from "https://esm.sh/langchain@0.0.77/chat_models/openai.js";
// import { AIChatMessage, HumanChatMessage, SystemChatMessage } from "https://esm.sh/langchain@0.0.77/schema.js";

// const chat = new ChatOpenAI({
// 	temperature: 0.9,
// 	openAIApiKey,
// });

// console.time("chat");
// const resposeA = await chat.call([
// 	new SystemChatMessage(`You are a helpful assistance.`),
// 	new AIChatMessage(`How may I help you today?`),
// 	new HumanChatMessage(`Can you suggest me a title for an article about good fishing spot in Rouyn-Noranda? I only one the best suggestion you got.`),
// 	new AIChatMessage(`Sure, here's a suggestion: "Reeling in the Best Catches: Exploring the Top Fishing Spots in Rouyn-Noranda".`),
// 	new HumanChatMessage(`Write me an intro for that article, in french.`),
// ]);
// console.timeEnd("chat");
// console.log(resposeA?.text);
