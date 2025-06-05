import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Aquí definiremos la herramienta para crear un issue en Jira.
// Por ahora, será un placeholder.
// TODO: Implementar la lógica real para interactuar con la API de Jira.

export const createJiraIssueTool = tool(
  async ({ projectKey, summary, description, issueType }) => {
    console.log("Intentando crear issue en Jira:");
    console.log(`  Proyecto: ${projectKey}`);
    console.log(`  Resumen: ${summary}`);
    console.log(`  Descripción: ${description}`);
    console.log(`  Tipo de Issue: ${issueType}`);

    // Simulación de creación de issue
    const issueId = `JIRA-${Math.floor(Math.random() * 1000) + 1}`;
    const issueUrl = `https://your-jira-instance.atlassian.net/browse/${issueId}`;

    return `Issue ${issueId} creado exitosamente. URL: ${issueUrl}`;
  },
  {
    name: "create_jira_issue",
    description: "Crea un nuevo issue en Jira con los detalles proporcionados.",
    schema: z.object({
      projectKey: z.string().describe("La clave del proyecto en Jira (ej. 'PROJ')."),
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