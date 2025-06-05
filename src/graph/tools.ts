import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";

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

export const tools = [createJiraIssueTool];
