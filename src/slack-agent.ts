import { Context, Handler } from "aws-lambda";
import { runAgent } from "./graph/agent";
import { getUserName, sendMessage } from "./slack"; // Importar el agente
import { markdownToBlocks } from "@tryfabric/mack";

export const handler: Handler = async (event: any, context: Context) => {
  try {
    const body = event;
    console.log("Received Slack event:", body);

    const slackEvent = body.event;
    const userMessage = slackEvent.text;
    const threadId = slackEvent.thread_ts || slackEvent.ts;
    const channelId = slackEvent.channel;
    const userId = slackEvent.user;
    let userName: string | null = await getUserName(userId);

    console.log(
      `User message: "${userMessage}", Thread ID: ${threadId}, User Name: ${userName || "No disponible"}, Channel ID: ${channelId}`,
    );

    const agentResponse = await runAgent(userMessage, userName, threadId);
    console.log(`Agent response: ${agentResponse}`);

    if (agentResponse) {
      const blocks = await markdownToBlocks(agentResponse);

      await sendMessage(channelId, "", threadId, blocks);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Event processed successfully" }),
    };
  } catch (error) {
    console.error("Error processing Slack event:", error);
    // Considerar cerrar el cliente de MongoDB en caso de error también.
    // await closeMongoClient(); // Considerar cerrar en caso de error también
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};
