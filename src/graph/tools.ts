import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { EventSource } from "eventsource"; // MessageEvent debería estar disponible globalmente con @types/eventsource

// Jira configuration from environment variables
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  throw new Error("Missing required Jira configuration in environment variables");
}

export const createJiraIssueTool = tool(
  async ({ projectKey, summary, description, issueType }) => {
    console.log("Intentando crear issue en Jira:");
    console.log(`  Proyecto: ${projectKey}`);
    console.log(`  Resumen: ${summary}`);
    console.log(`  Descripción: ${description}`);
    console.log(`  Tipo de Issue: ${issueType}`);

    try {
      const response = await axios.post(
        `https://${JIRA_DOMAIN}.atlassian.net/rest/api/3/issue`,
        {
          fields: {
            project: {
              key: projectKey,
            },
            summary: summary,
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: description,
                    },
                  ],
                },
              ],
            },
            issuetype: {
              name: issueType,
            },
          },
        },
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${JIRA_EMAIL}:${JIRA_API_TOKEN}`
            ).toString("base64")}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      const issueKey = response.data.key;
      const issueUrl = `https://${JIRA_DOMAIN}.atlassian.net/browse/${issueKey}`;
      return `Issue ${issueKey} creado exitosamente. URL: ${issueUrl}`;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage =
          error.response?.data?.errorMessages?.join(", ") || error.message;
        console.log(`Error al crear el issue en Jira: ${errorMessage}`);
        throw new Error(`Error al crear el issue en Jira: ${errorMessage}`);
      }
      throw error;
    }
  },
  {
    name: "create_jira_issue",
    description: "Crea un nuevo issue en Jira con los detalles proporcionados.",
    schema: z.object({
      projectKey: z
        .string()
        .describe("La clave del proyecto en Jira (ej. 'PROJ')."),
      summary: z.string().describe("Un resumen conciso del issue."),
      description: z.string().describe("Una descripción detallada del issue."),
      issueType: z
        .string()
        .describe(
          "El tipo de issue (ej. 'Task', 'Bug', 'Story'). Por defecto es 'Task'."
        )
        .default("Task"),
    }),
  }
);

// Eliminada la primera declaración de 'tools' para evitar redeclaración.
const DEVELOPMENT_AGENT_URL = process.env.DEVELOPMENT_AGENT_URL;
const DEVELOPMENT_AGENT_API_KEY = process.env.DEVELOPMENT_AGENT_API_KEY;

if (!DEVELOPMENT_AGENT_URL || !DEVELOPMENT_AGENT_API_KEY) {
  throw new Error("Missing required Development Agent configuration in environment variables");
}

export const sendTaskToDevelopmentTool = tool(
  async ({ query, jiraTicketID }: { query: string, jiraTicketID?: string }) => {
    return new Promise<string>((resolve, reject) => {
      const url = DEVELOPMENT_AGENT_URL;
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": DEVELOPMENT_AGENT_API_KEY,
        Accept: "application/octet-stream",
      };
      let request = query;
      if (jiraTicketID) {
        request += `\nPuedes obtener más información del ticket de Jira: ${jiraTicketID}`;
      }
      const body = JSON.stringify({ query: request });

      const es = new EventSource(url, {
        method: "POST",
        headers: headers,
        body: body,
      } as EventSourceInit);

      let fullResponse = "";

      es.onmessage = (event: MessageEvent) => {
        fullResponse += event.data;
      };

      es.onerror = (error: Event) => { // Usar Event o any si MessageEvent no es adecuado para error
        console.error("SSE Error:", error);
        es.close();
        // @ts-ignore
        const errorMessage = error.message || "Error desconocido";
        reject(
          new Error(
            `Error en la conexión SSE: ${errorMessage}`
          )
        );
      };

      const originalOnMessage = es.onmessage;
      es.onmessage = (event: MessageEvent) => { // Especificar tipo para event
        if (event.data === "[DONE]") {
          es.close();
          resolve(fullResponse);
          return;
        }
        // Asegurarse de que originalOnMessage no sea null antes de llamarlo
        if (originalOnMessage) {
          originalOnMessage(event);
        }
      };
    });
  },
  {
    name: "send_task_to_developement",
    description:
      "Realiza una petición a un servicio de desarrollo de código mediante SSE y devuelve la respuesta completa.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "La pregunta o instrucción para el servicio de desarrollo de código."
        ),
      jiraTicketID: z
        .string()
        .optional()
        .describe(
          "ID del ticket de Jira relacionado, opcional. Si se proporciona, se incluirá en la petición."
        ),
    }),
  }
);

// Modificada la declaración de 'tools' para incluir ambas herramientas.
export const tools = [createJiraIssueTool, sendTaskToDevelopmentTool];
