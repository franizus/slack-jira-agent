import {tool} from "@langchain/core/tools";
import {z} from "zod";
import {sendIssue} from "../gateway/jira";
import {fetchSse} from "../gateway/sse";

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
            const {issueKey, issueUrl} = await sendIssue({
                projectKey,
                summary,
                description,
                issueType,
                assigneeEmailAddress,
                uatDeployDate,
                prodDeployDate,
                priority,
                methodology,
                parentIssueKey
            })
            return `Issue ${issueKey} creado exitosamente. URL: ${issueUrl}`;
        } catch (error) {
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
    async ({query, jiraTicketID}: { query: string, jiraTicketID?: string }) => {
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

            fetchSse(url, {
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

// Modificada la declaración de 'tools' para incluir ambas herramientas.
export const tools = [createJiraIssueTool, sendTaskToDevelopmentTool];



