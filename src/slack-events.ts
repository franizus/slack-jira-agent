import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { isEventProcessed, markEventAsProcessed } from "./db"; // Importar funciones de DB
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { assistentThreadSetStatus, getUserName, sendMessage } from "./slack"; // SDK de AWS Lambda

const TARGET_LAMBDA_ARN = process.env.TARGET_LAMBDA_ARN!;
const lambdaClient = new LambdaClient({});

export const handler: Handler = async (
  event: APIGatewayEvent,
  context: Context,
) => {
  try {
    const body = JSON.parse(event.body || "{}");
    console.log("Received Slack event:", body);

    if (body.type === "url_verification") {
      return {
        headers: { "Content-Type": "application/json" },
        statusCode: 200,
        body: JSON.stringify({ challenge: body.challenge }),
      };
    }

    if (body.type === "event_callback") {
      // Solo procesar si web está inicializado
      const slackEvent = body.event;
      const eventId = body.event_id; // ID único del evento de Slack
      const threadId = slackEvent.thread_ts || slackEvent.ts;
      const channelId = slackEvent.channel;
      console.log(`Procesando event_callback con event_id: ${eventId}`);

      // Marcar el evento como procesado DESPUÉS de la lógica principal o justo antes de retornar éxito.
      // Si hay múltiples caminos de salida exitosos, asegurarse de llamarlo en todos.
      // Por simplicidad, lo llamaremos al final del bloque event_callback si no hubo error antes.

      if (slackEvent.type === "assistant_thread_started") {
        console.log("Assistant thread started event received:", slackEvent);
        const threadId =
          slackEvent.assistant_thread?.thread_ts || slackEvent.event_ts;
        const channelId = slackEvent.assistant_thread?.channel_id;
        const userId = slackEvent.assistant_thread?.user_id;
        let userName: string | null = await getUserName(userId);

        await sendMessage(channelId, "", threadId, [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🎯 ¡Hola! ${userName}, Soy tu asistente para Jira`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Puedo ayudarte a convertir *texto libre o contexto de producto* en artefactos listos para Jira: épicas, historias de usuario, subtareas técnicas y más.\n\nPuedes empezar escribiendo algo como:\n• `Crea una épica para exponer comerceCode en el API de branches`\n• `Genera historias con criterios de aceptación para este flujo`\n\n¿Con qué quieres comenzar?",
            },
          },
        ]);
      } else if (
        slackEvent.type === "message" &&
        !slackEvent.bot_id &&
        !slackEvent.subtype &&
        slackEvent.text
      ) {
        if (eventId) {
          const alreadyProcessed = await isEventProcessed(eventId);
          if (alreadyProcessed) {
            console.log(`Evento ${eventId} ya fue procesado. Ignorando.`);
            return {
              statusCode: 200,
              body: JSON.stringify({ message: "Event already processed" }),
            };
          }
        }

        // invoke async lambda agent
        console.log(
          `Evento ${eventId} es nuevo. Invocando Lambda de procesamiento: ${TARGET_LAMBDA_ARN}`,
        );

        await assistentThreadSetStatus(channelId, threadId);

        try {
          await lambdaClient.send(
            new InvokeCommand({
              FunctionName: TARGET_LAMBDA_ARN,
              InvocationType: "Event", // Invocación asíncrona
              Payload: JSON.stringify(body), // Enviar el cuerpo completo del evento original
            }),
          );
          console.log(
            `Lambda ${TARGET_LAMBDA_ARN} invocada asíncronamente para el evento ${eventId}.`,
          );

          // Marcar como procesado EN ESTA LAMBDA para no volver a invocar la otra.
          await markEventAsProcessed(eventId);
        } catch {
          console.error(
            `Error al invocar la Lambda ${TARGET_LAMBDA_ARN} para el evento ${eventId}.`,
          );
          return {
            statusCode: 500,
            body: JSON.stringify({
              message: "Error invoking processing Lambda",
            }),
          };
        }
      }
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
