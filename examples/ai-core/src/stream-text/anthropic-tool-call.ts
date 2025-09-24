import 'dotenv/config';
import { anthropic } from '@ai-sdk/anthropic';
import { stepCountIs, experimental_createMCPClient, streamText, TextStreamPart } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function main() {
  const transport = new StdioClientTransport({
      command: '/Users/suyao/.bun/bin/bunx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxx"
      }
    });
  const stdioClient = await experimental_createMCPClient({
      transport,
  });

  const tools = await stdioClient.tools()

  const transfrom = () => { 
        let thinkingStartTime = 0
        let hasStartedThinking = false
        let accumulatedThinkingContent = ''
        return new TransformStream<TextStreamPart<any>, TextStreamPart<any>>({
            transform(chunk, controller) {
                        if (chunk.type === 'reasoning-start') {
                            controller.enqueue(chunk)
                            hasStartedThinking = true
                            thinkingStartTime = performance.now()
                        } else if (chunk.type === 'reasoning-delta') {
                            accumulatedThinkingContent += chunk.text
                            const newChunk = {
                                ...chunk,
                                providerMetadata: {
                                    ...chunk.providerMetadata,
                                    metadata: {
                                    ...chunk.providerMetadata?.metadata,
                                    thinking_millsec: performance.now() - thinkingStartTime,
                                    thinking_content: accumulatedThinkingContent
                                    }
                                }
                            }
                            controller.enqueue(newChunk)
                        } else if (chunk.type === 'reasoning-end' && hasStartedThinking) {
                            controller.enqueue({
                                type: 'reasoning-end',
                                id: chunk.id,
                                providerMetadata: {
                                    metadata: {
                                        ...chunk.providerMetadata?.metadata,
                                        thinking_millsec: performance.now() - thinkingStartTime,
                                        thinking_content: accumulatedThinkingContent
                                    }
                                }
                            })
                            accumulatedThinkingContent = ''
                            hasStartedThinking = false
                            thinkingStartTime = 0
                        } else {
                            controller.enqueue(chunk)
                        }
            }
        })
  }

  const result = streamText<any, TextStreamPart<any>, TextStreamPart<any>>({
    model: anthropic('claude-sonnet-4-20250514'),
    messages: [
        { role: 'user', content: 'node' },
        { role: 'assistant', content: 'nodejs is a runtime environment for executing JavaScript code outside of a web browser.' },
        { role: 'user', content: 'https://github.com/vercel/ai/issues/8865 analyze the issue and give me a summary' },
    ],
    tools: tools,
    providerOptions: {
        anthropic: {
            stream: true,
            thinking: {
                type: 'enabled',
                budgetTokens: 3276
            }
        }
    },
    onFinish: async () => {
      await stdioClient.close();
    },
    onError: async (error) => {
      await stdioClient.close();
      console.error('Error:', error);
    },
    stopWhen: stepCountIs(10),
    experimental_transform: transfrom
  });

  for await (const part of result.fullStream) {
    console.log(JSON.stringify(part));
  }

  console.log();
  console.log('Sources:', (await result.sources).length);
  console.log('Usage:', await result.usage);
  console.log();
}

main().catch(console.error);
