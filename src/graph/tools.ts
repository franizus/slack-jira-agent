import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { marked } from "marked";

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
    methodology
  }) => {
    console.log("Intentando crear issue en Jira:", {
      projectKey,
      summary,
      description,
      issueType,
      assigneeEmailAddress,
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
            )
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
      let request = query;
      if (jiraTicketID) {
        request += `\nPuedes obtener más información del ticket de Jira: ${jiraTicketID}`;
      }
      const body = JSON.stringify({ query: request });


      const raw = JSON.stringify({
        "query": "crear una nueva función Lambda en `usrv-card` para obtener detalles de transacciones por `transaction-reference`"
      });

      const requestOptions: RequestInit = {
        method: "POST",
        headers: headers,
        body: raw,
        redirect: "follow"
      };

      fetch(DEVELOPMENT_AGENT_URL, requestOptions)
          .then((response) => {
            const reader = response.body?.getReader();
            const decoder = new TextDecoder("utf-8");
            let finalResultMessage = "";

            if (!reader) {
                throw new Error("No reader available for response body");
            }

            return reader.read().then(function processStream({ done, value }) {
                if (done) {
                    try {
                        const jsonResponse = JSON.parse(finalResultMessage);
                        resolve(jsonResponse);
                    } catch (error) {
                        reject(new Error("Failed to parse JSON response: " + error.message));
                    }
                    return;
                }

                finalResultMessage += decoder.decode(value, { stream: true });
                return reader.read().then(processStream);
            });
          })
          .catch((error) => reject(error));
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
