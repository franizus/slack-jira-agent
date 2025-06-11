import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { marked } from "marked";
import {error} from "aws-cdk/lib/logging";

// Jira configuration from environment variables
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  throw new Error("Missing required Jira configuration in environment variables");
}

/**
 * Converts Markdown to Atlassian Document Format (ADF).
 * @param markdown - The Markdown string to convert.
 * @returns ADF-compliant JSON object.
 */
function markdownToADF(markdown: string): any {
  const tokens = marked.lexer(markdown);

  const adfContent = tokens.map((token) => {
    if (token.type === "paragraph") {
      return {
        type: "paragraph",
        content: [{ type: "text", text: token.text }],
      };
    }

    if (token.type === "heading") {
      return {
        type: "heading",
        attrs: { level: token.depth },
        content: [{ type: "text", text: token.text }],
      };
    }

    if (token.type === "table") {
      const tableContent = token.rows.map((row: any[]) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: "tableCell",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: cell.text || "" }],
          }],
        })),
      }));

      if (token.header) {
        tableContent.unshift({
          type: "tableRow",
          content: token.header.map((cell: { text: any; }) => ({
            type: "tableHeader",
            content: [{
              type: "paragraph",
              content: [{
                type: "text",
                text: cell.text || "",
                marks: [{ type: "strong" }],
              }],
            }],
          })),
        });
      }

      return { type: "table", content: tableContent };
    }

    return null; // Skip unsupported token types
  }).filter(Boolean);

  return { type: "doc", version: 1, content: adfContent };
}

/**
 * Retrieves user ID of the assignee and search on the jira users API
 * @param assigneeEmailAddress - The email address of the assignee.
 * @returns Jira user ID
 */
async function getAssigneeUserID(assigneeEmailAddress: string): Promise<string> {
  const url = `https://${JIRA_DOMAIN}.atlassian.net/rest/api/3/user/search?query=${encodeURIComponent(assigneeEmailAddress)}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const { data } = await axios.get(url, { headers });

  if (!data?.length) {
    console.error('Response:', data);
    throw new Error(`No se encontró un usuario con el email: ${assigneeEmailAddress}`);
  }

  return data[0].accountId;
}

// Update the createJiraIssueTool to use markdownToADF
export const createJiraIssueTool = tool(
  async ({
    projectKey,
    summary,
    description,
    issueType = "Task",
    assigneeEmailAddress,
    uatDeployDate,
    prodDeployDate,
    priority = "Medium",
    methodology,
   parentIssueKey
  }) => {
    console.log("Intentando crear issue en Jira:", {
      projectKey,
      summary,
      description,
      issueType,
      assigneeEmailAddress,
      parentIssueKey
    });

    try {
      const adfDescription = markdownToADF(description);
      const assigneeId = await getAssigneeUserID(assigneeEmailAddress);

      const requestBody = {
        fields: {
          project: { key: projectKey },
          summary,
          description: adfDescription,
          issuetype: { name: issueType },
          assignee: { id: assigneeId },
          ...(uatDeployDate && { customfield_11942: uatDeployDate }),
          ...(prodDeployDate && { customfield_11896: prodDeployDate }),
          ...(priority && { priority: { name: priority } }),
          ...(methodology?.length && {
            customfield_12155: methodology.map((method) => ({ value: method })),
          }),
          ...(parentIssueKey && { parent: { key: parentIssueKey } }),
        },
      };

      console.log("Request Body:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post(
        `https://${JIRA_DOMAIN}.atlassian.net/rest/api/3/issue`,
        requestBody,
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
        assigneeEmailAddress: z
            .string()
            .describe("El email del usuario al que se asignará el issue."),
        uatDeployDate: z
            .string()
            .optional()
            .describe("Fecha de despliegue UAT en formato 'YYYY-MM-DD', opcional."),
        prodDeployDate: z
            .string()
            .optional()
            .describe("Fecha de despliegue en producción en formato 'YYYY-MM-DD', opcional."),
        priority: z
            .enum(["Highest", "High", "Medium", "Low", "Lowest"])
            .describe("Prioridad del issue (ej. 'Highest', 'High', 'Medium', 'Low', 'Lowest').")
            .default("Medium"),
        methodology: z
            .array(z.enum(["Scrum", "Kanban"]))
            .describe(
                "Metodología de desarrollo asociada al issue (ej. 'Scrum', 'Kanban')."
            ),
        parentIssueKey: z
            .string()
            .optional()
            .describe(
                "Clave del issue padre si este issue es un subtipo. Por ejemplo, 'PROJ-123'."
            ),
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
      console.log("query:", query);
      console.log("jiraTicketID:", jiraTicketID);
      const url = DEVELOPMENT_AGENT_URL;
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": DEVELOPMENT_AGENT_API_KEY,
        Accept: "application/octet-stream",
      };

      const raw = JSON.stringify({
        "query": query
      });

      const requestOptions: RequestInit = {
        method: "POST",
        headers: headers,
        body: raw,
        redirect: "follow"
      };

      fetchSse(url,{
        ...requestOptions,
        onMessage: (event) => {
          console.log("Evento SSE recibido:", event);
          if (event.event === "final_result_message") {
            const response = JSON.parse(event.data);
            console.log("Respuesta completa del servicio de desarrollo:", response);
            resolve(response.result_message || "Respuesta recibida sin mensaje específico.");
          } else {
            console.log("Mensaje genérico:", event.data);
          }
        },
        onError: (error) => {
          console.error("Error en la conexión SSE:", error);
          reject(error);
        },
      });
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
          "markdown completo la historia de usuario creada previamente en jira para contexto de las subtareas técnicas. "
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
// Definimos una interfaz para los eventos que esperamos recibir
interface SseEvent {
  event?: string; // El nombre del evento (si es personalizado)
  data: string;  // Los datos del evento
  id?: string;    // El ID del evento
}

// Opciones para nuestra función de fetch
interface FetchSseOptions extends RequestInit {
  onMessage: (event: SseEvent) => void;
  onError?: (error: any) => void;
  // Puedes añadir un onOpen o onClose si lo necesitas
}

async function fetchSse(url: string, options: FetchSseOptions): Promise<void> {
  const { onMessage, onError, ...fetchOptions } = options;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        'Accept': 'text/event-stream',
        // Agrega cualquier otro encabezado que necesites
        ...fetchOptions.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processStream = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break; // El stream ha finalizado
        }

        // Decodificamos el chunk y lo añadimos al buffer
        buffer += decoder.decode(value, { stream: true });

        // Buscamos delimitadores de mensaje ('\n\n') en el buffer
        let boundaryIndex;
        while ((boundaryIndex = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.substring(0, boundaryIndex);
          buffer = buffer.substring(boundaryIndex + 2); // Eliminamos el mensaje procesado del buffer

          if (message.startsWith(':')) { // Es un comentario, lo ignoramos
            continue;
          }

          const sseEvent: SseEvent = { data: '' };
          const lines = message.split('\n');

          for (const line of lines) {
            if (line.startsWith('data:')) {
              // Si ya hay datos, se agrega una nueva línea (para datos multilínea)
              if(sseEvent.data) sseEvent.data += '\n';
              sseEvent.data += line.substring(5).trim();
            } else if (line.startsWith('event:')) {
              sseEvent.event = line.substring(6).trim();
            } else if (line.startsWith('id:')) {
              sseEvent.id = line.substring(3).trim();
            }
            // Aquí se podría manejar el campo 'retry:' si fuera necesario
          }

          if (sseEvent.data) {
            onMessage(sseEvent);
          }
        }
      }
    };

    await processStream();

  } catch (error) {
    if (onError) {
      onError(error);
    } else {
      console.error('SSE fetch error:', error);
    }
  }
}

// --- CÓMO USAR LA FUNCIÓN ---

const sseEndpoint = 'http://localhost:3000/sse'; // Cambia esto a tu endpoint

console.log('Conectando al stream SSE...');

fetchSse(sseEndpoint, {
  method: 'GET', // o 'POST' si tu endpoint lo requiere
  headers: {
    'Authorization': 'Bearer tu-token-aqui', // Ejemplo de encabezado personalizado
  },
  onMessage: (event) => {
    console.log('Evento SSE recibido:');

    // Si tienes eventos con nombre, puedes usar un switch
    switch (event.event) {
      case 'final_result_message':
        console.log('Evento de actualización de usuario:');
        const userData = JSON.parse(event.data);
        console.log(userData);
        break;
      default: // Eventos sin nombre (onmessage)
        console.log('Mensaje genérico:', event.data);
        break;
    }

    if (event.id) {
      console.log(`ID del evento: ${event.id}`);
    }
  },
  onError: (error) => {
    console.error('Hubo un error con la conexión SSE:', error);
  }
});















// Modificada la declaración de 'tools' para incluir ambas herramientas.
export const tools = [createJiraIssueTool, sendTaskToDevelopmentTool];



