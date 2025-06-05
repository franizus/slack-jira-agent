import { Block, KnownBlock, WebClient } from "@slack/web-api"; // Importar WebClient

// Inicializar WebClient. Asegúrate de que SLACK_BOT_TOKEN esté en las variables de entorno.
const slackToken = process.env.SLACK_BOT_TOKEN;
let web: WebClient | undefined;
if (slackToken) {
  web = new WebClient(slackToken);
} else {
  console.warn(
    "SLACK_BOT_TOKEN no está configurado. Las interacciones con la API de Slack (obtener info de usuario, enviar mensajes) no funcionarán.",
  );
}

export const getUserName = async (userId: string): Promise<string | null> => {
  if (!web) {
    console.warn(
      "WebClient no está inicializado. No se puede obtener el nombre de usuario.",
    );
    return null;
  }
  try {
    const userInfo = await web.users.info({ user: userId });
    if (userInfo.ok && userInfo.user) {
      return (
        (userInfo.user as any).profile?.real_name_normalized ||
        (userInfo.user as any).profile?.real_name ||
        null
      );
    } else {
      console.warn(
        `No se pudo obtener la información del usuario: ${userInfo.error}`,
      );
      return null;
    }
  } catch (error) {
    console.error(
      "Error al obtener la información del usuario desde la API de Slack:",
      error,
    );
    return null;
  }
};

export const sendMessage = async (
  channelId: string,
  text: string,
  threadTs?: string,
  blocks?: (Block | KnownBlock)[],
): Promise<void> => {
  if (!web) {
    console.warn(
      "WebClient no está inicializado. No se puede enviar el mensaje.",
    );
    return;
  }
  try {
    await web.chat.postMessage({
      channel: channelId,
      text: text,
      blocks: blocks,
      thread_ts: threadTs, // Si se proporciona, envía en el hilo
    });
  } catch (error) {
    console.error("Error al enviar el mensaje a Slack:", error);
  }
};

export const assistentThreadSetStatus = async (
  channelId: string,
  threadTs: string,
  status?: string,
): Promise<void> => {
  if (!web) {
    console.warn(
      "WebClient no está inicializado. No se puede establecer el estado del hilo.",
    );
    return;
  }
  try {
    await web.assistant.threads.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status: status || "pensando...", // Establece un estado por defecto si no se proporciona
    });
  } catch (error) {
    console.error("Error al establecer el estado del hilo:", error);
  }
};
