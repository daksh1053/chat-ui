import { buildPrompt } from "$lib/buildPrompt";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";
import fs from "fs";

export const endpointOllamaParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("ollama"),
	url: z.string().url().default("http://127.0.0.1:11434"),
	ollamaName: z.string().min(1).optional(),
});

export function endpointOllama(input: z.input<typeof endpointOllamaParametersSchema>): Endpoint {
	const { url, model, ollamaName } = endpointOllamaParametersSchema.parse(input);

	return async ({ messages, preprompt, continueMessage, generateSettings }) => {
		const prompt = await buildPrompt({
			messages,
			continueMessage,
			preprompt,
			model,
		});

		console.log("********");
		console.log("prompt", prompt);
		console.log("********");

		const parameters = { ...model.parameters, ...generateSettings };

		const requestInfo = await fetch(`${url}/api/tags`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});

		const tags = await requestInfo.json();

		if (!tags.models.some((m: { name: string }) => m.name === ollamaName)) {
			// if its not in the tags, pull but dont wait for the answer
			fetch(`${url}/api/pull`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: ollamaName ?? model.name,
					stream: false,
				}),
			});

			throw new Error("Currently pulling model from Ollama, please try again later.");
		}

		const r = await fetch(`${url}/api/generate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				prompt,
				model: ollamaName ?? model.name,
				raw: true,
				options: {
					top_p: parameters.top_p,
					top_k: parameters.top_k,
					temperature: parameters.temperature,
					repeat_penalty: parameters.repetition_penalty,
					stop: parameters.stop,
					num_predict: parameters.max_new_tokens,
				},
			}),
		});

		if (!r.ok) {
			throw new Error(`Failed to generate text: ${await r.text()}`);
		}

		const encoder = new TextDecoderStream();
		const reader = r.body?.pipeThrough(encoder).getReader();

		return (async function* () {
			let generatedText = "";
			let tokenId = 0;
			let stop = false;

			try {
				fs.appendFileSync(
					"ollama_output.log",
					`\n\n=================\nPROMPT:\n${prompt}\n\nRESPONSE:\n`
				);
			} catch (e) {
				console.error("Failed to write to ollama_output.log", e);
			}

			while (!stop) {
				// read the stream and log the outputs to console
				const out = (await reader?.read()) ?? { done: false, value: undefined };
				// we read, if it's done we cancel
				if (out.done) {
					reader?.cancel();
					return;
				}

				if (!out.value) {
					return;
				}

				let data = null;
				try {
					data = JSON.parse(out.value);
				} catch (e) {
					return;
				}
				if (!data.done) {
					generatedText += data.response;

					try {
						fs.appendFileSync("ollama_output.log", data.response ?? "");
					} catch (e) {
						console.error("Failed to write to ollama_output.log", e);
					}

					yield {
						token: {
							id: tokenId++,
							text: data.response ?? "",
							logprob: 0,
							special: false,
						},
						generated_text: null,
						details: null,
					} satisfies TextGenerationStreamOutput;
				} else {
					stop = true;
					try {
						fs.appendFileSync("ollama_output.log", "\n");
					} catch (e) {
						console.error("Failed to write to ollama_output.log", e);
					}
					yield {
						token: {
							id: tokenId++,
							text: data.response ?? "",
							logprob: 0,
							special: true,
						},
						generated_text: generatedText,
						details: null,
					} satisfies TextGenerationStreamOutput;
				}
			}
		})();
	};
}

export default endpointOllama;
