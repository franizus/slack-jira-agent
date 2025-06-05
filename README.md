# Slack Jira Agent

Este proyecto implementa un agente de Slack que interactúa con Jira. Permite a los usuarios convertir texto libre o contexto de producto en artefactos de Jira como épicas, historias de usuario y subtareas técnicas directamente desde Slack.

## Arquitectura

La aplicación está construida utilizando AWS CDK y se compone de los siguientes recursos principales:

1.  **API Gateway (`SlackEventsApi`)**: Expone un endpoint HTTP (`/slack`) que recibe eventos de Slack.
2.  **Lambda Function (`SlackEventsLambda`)**:
    *   Se encuentra en [`src/slack-events.ts`](src/slack-events.ts:1).
    *   Maneja la verificación inicial de la URL de Slack.
    *   Procesa los eventos de `event_callback` de Slack.
    *   Cuando se inicia un hilo de asistente (`assistant_thread_started`), envía un mensaje de bienvenida.
    *   Cuando se recibe un mensaje de un usuario en un hilo, invoca de forma asíncrona a `SlackAgentLambda`.
    *   Utiliza MongoDB para rastrear los eventos procesados y evitar la duplicación de trabajo.
3.  **Lambda Function (`SlackAgentLambda`)**:
    *   Se encuentra en [`src/slack-agent.ts`](src/slack-agent.ts:1).
    *   Recibe el mensaje del usuario desde `SlackEventsLambda`.
    *   Utiliza un agente (definido en [`src/graph/agent.ts`](src/graph/agent.ts:1)) para procesar la solicitud del usuario y generar una respuesta.
    *   Envía la respuesta del agente de vuelta al hilo de Slack correspondiente.
4.  **MongoDB**: Se utiliza como base de datos para almacenar los IDs de los eventos de Slack que ya han sido procesados, previniendo el procesamiento duplicado de eventos. La lógica de base de datos se encuentra en [`src/db.ts`](src/db.ts:1).

El stack de AWS CDK que define esta infraestructura se encuentra en [`lib/slack-jira-agent-stack.ts`](lib/slack-jira-agent-stack.ts:1).

## Variables de Entorno

La aplicación requiere las siguientes variables de entorno, que deben configurarse en un archivo `.env` en la raíz del proyecto:

*   `GOOGLE_API_KEY`: Clave API para los servicios de Google (si son utilizados por el agente).
*   `SLACK_BOT_TOKEN`: Token de bot de Slack para interactuar con la API de Slack.
*   `MONGODB_URI`: URI de conexión a la base de datos MongoDB.

## Comandos Útiles

*   `npm install`: Instalar dependencias del proyecto.
*   `npm run build`: Compilar el código TypeScript a JavaScript.
*   `npm run watch`: Observar cambios en los archivos TypeScript y compilar automáticamente.
*   `npm run test`: Ejecutar las pruebas unitarias con Jest.
*   `npx cdk deploy`: Desplegar este stack a tu cuenta/región de AWS por defecto.
*   `npx cdk diff`: Comparar el stack desplegado con el estado actual.
*   `npx cdk synth`: Emitir la plantilla de CloudFormation sintetizada.
