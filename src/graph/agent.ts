import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { AgentStateType, AgentState } from "./state";
import { tools } from "./tools";
import { MongoClient } from "mongodb";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";

// Configura el modelo LLM
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-preview-05-20",
  temperature: 0.1,
});

// Vincula las herramientas al modelo
const modelWithTools = model.bindTools(tools);

// Configuración de MongoDB Checkpointer
const mongoDbUri = process.env.MONGODB_URI;
let mongoSaver: MongoDBSaver | undefined;

if (mongoDbUri) {
  const client = new MongoClient(mongoDbUri);
  // Es buena práctica conectar explícitamente y manejar errores,
  // pero MongoDBSaver puede manejar la conexión implícitamente.
  // Considera agregar client.connect() y client.close() en el ciclo de vida de tu app/lambda.
  console.log("Conectando a MongoDB para LangGraph checkpointer...");
  mongoSaver = new MongoDBSaver({
    client,
    dbName: "slack-jira-agent", // Nombre de la base de datos
  });
  console.log("MongoDBSaver instanciado.");
} else {
  console.warn(
    "MONGODB_URI no está configurada. LangGraph usará un checkpointer en memoria (MemorySaver por defecto si no se especifica).",
  );
  // Podrías optar por un MemorySaver aquí como fallback si es necesario,
  // o dejar que LangGraph use su comportamiento por defecto (sin persistencia a menos que se configure).
  // import { MemorySaver } from "@langchain/langgraph";
  // mongoSaver = new MemorySaver(); // Ejemplo de fallback
}

// Nodo que llama al modelo LLM
const callModelNode = async (
  state: AgentStateType,
): Promise<Partial<AgentStateType>> => {
  const { messages, userName } = state; // Extraer userName del estado

  // Construir el contenido del systemMessage dinámicamente
  let systemPromptContent =
    "# Role\n" +
    "Eres un **Agente de Product Management para Jira**.  \n" +
    "Tu especialidad es transformar texto libre (español o inglés) en artefactos **listos para Jira** (épicas, historias de usuario y subtareas técnicas), accionando las herramienta `create_jira_issue` cuando corresponda.";

  if (userName) {
    systemPromptContent += ` El usuario que te esta haciendo la petición se llama ${userName}.\n`;
  } else {
    systemPromptContent += "\n";
  }

  systemPromptContent +=
    "\n" +
    "# Instructions\n" +
    "1. **Detecta el tipo de petición**  \n" +
    "   - **Épica** → genera:  \n" +
    "     - **Título**  \n" +
    "     - **Descripción**  \n" +
    "     - **Objetivo de negocio**  \n" +
    "     - **Tech Lead**, **Assignee**, **Reporter**  \n" +
    "     - **Methodology**, **Quarter**, **Priority**, **Epic type**  \n" +
    "     - **Release note**, **Fix versions**, **Env**  \n" +
    "     - **Definition of Ready** y **Definition of Done** (etiquetas/“chips” que usa el equipo)  \n" +
    "     - Cualquier otro campo obligatorio que exija Jira Cloud de Kushki.\n" +
    "   - **Historia de usuario** → genera:  \n" +
    "     - Formato “Como \\<rol\\> quiero \\<qué\\> para \\<por qué\\>”.  \n" +
    "     - Tabla de **criterios de aceptación** con columnas **Dado que | Cuando | Entonces**.  \n" +
    "     - **Priority**, **Components**, **Story Points**.  \n" +
    "     - **Subtareas técnicas** si es necesario (API, BD, QA, documentación…).  \n" +
    "2. **Uso de herramientas**  \n" +
    "   - Después de que el usuario **apruebe** la épica o historias, invoca:  \n" +
    "     - `create_jira_issue` para crear epicas, historias y subtareas (relacionándolas a la épica) en Jira.  \n" +
    "   - Si la tarea requiere desarrollo de código, puedes usar la herramienta `send_task_to_developement`. **Pregunta siempre al usuario si desea enviar la tarea al agente de desarrollo antes de usar esta herramienta.**  \n" +
    "     - Puedes usarla después de crear un issue en Jira, proporcionando el `query` con todo el markdown de la historia, epica o subtarea. \n" +
    "     - También puedes usarla directamente para una solicitud de desarrollo de código sin un issue de Jira previo, proporcionando solo el `query`. \n" +
    "3. **Solicitud de datos faltantes**  \n" +
    "   - Si falta algún campo requerido, **pregunta explícitamente** al usuario antes de ejecutar las herramientas.  \n" +
    "   - Resume las preguntas en una lista clara y concisa.  \n" +
    "4. **Formato de salida**  \n" +
    "   - Responde en **Markdown**.  \n" +
    "   - Encierra tablas con `|` y usa encabezados `###` para secciones principales.  \n" +
    "   - Destaca los nombres de campos obligatorios en **negritas** la primera vez que aparezcan.\n" +
    "\n" +
    "# Rules\n" +
    "1. Responde en español salvo que el usuario escriba en otro idioma.  \n" +
    "2. No inventes requisitos ni valores; adhiérete al input o a buenas prácticas explícitas.  \n" +
    "3. Pregunta como máximo dos veces para aclarar ambigüedades antes de generar artefactos.  \n" +
    "4. Mantén consistencia terminológica: *branch*, *comerceCode*, *transaction-rule-processor*, etc.  \n" +
    "5. Protege datos sensibles; no reveles credenciales ni información interna no solicitada.  \n" +
    "6. Longitud recomendada: ≤ 400 palabras por épica, ≤ 250 palabras por historia.\n" +
    "\n" +
    "# Additional Context\n" +
    "- La instancia es **Jira Cloud** con flujo Kanban estándard.  \n" +
    "- Campos de épica e historia pueden variar; pregúntalos si no aparecen en la entrada.  \n" +
    "- Kushki trabaja en ambiente fintech y usa Appian como consumidor del API.  \n" +
    "- Normativa interna exige **Definition of Ready** con etiquetas: “Tener sesiones de 3 amigos”, “HU debe ser INVEST”, etc.\n" +
    "\n" +
    "# Reducing Hallucinations\n" +
    "- Señala cualquier **suposición** (“Se asume que…”) y pídele al usuario confirmarla.  \n" +
    "- No generes identificadores API ni esquemas BD que el usuario no proporcione.  \n" +
    "- Usa exactamente los nombres de campos enviados; si detectas inconsistencias, pregunta antes.  \n" +
    "- Antes de invocar `create_jira_epic` o `create_jira_issue`, verifica que todos los campos requeridos estén presentes o hayan sido aprobados por el usuario.\n";

  const systemMessage = new SystemMessage(systemPromptContent);

  const response = await modelWithTools.invoke([systemMessage, ...messages]);
  return { messages: [response] };
};

// Nodo que ejecuta las herramientas
const toolNode = new ToolNode<AgentStateType>(tools);

// Función para decidir el siguiente paso: continuar a herramientas o finalizar.
const shouldContinueNode = (state: AgentStateType): "tools" | typeof END => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tools"; // Si hay llamadas a herramientas, ve al nodo de herramientas
  }
  return END; // De lo contrario, finaliza
};

// Construye el grafo del agente
const workflow = new StateGraph(AgentState)
  .addNode("agent", callModelNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent") // El grafo comienza en el nodo 'agent'
  .addConditionalEdges("agent", shouldContinueNode) // Decide el siguiente paso después del nodo 'agent'
  .addEdge("tools", "agent"); // Después de ejecutar herramientas, vuelve al nodo 'agent'

// Compila el grafo en una aplicación ejecutable
// Pasa el mongoSaver si está disponible, de lo contrario LangGraph usará MemorySaver o ninguno.
export const agentApp = mongoSaver
  ? workflow.compile({ checkpointer: mongoSaver })
  : workflow.compile();

if (mongoSaver) {
  console.log("Grafo compilado con MongoDBSaver.");
} else {
  console.log(
    "Grafo compilado sin MongoDBSaver (usará MemorySaver o ninguno por defecto).",
  );
}

// Función para invocar al agente
export async function runAgent(
  input: string,
  userName: string | null, // Nuevo parámetro
  threadId?: string,
): Promise<string> {
  const initialState: AgentStateType = {
    messages: [new HumanMessage(input)],
    userName: userName, // Establecer userName en el estado inicial
  };

  // Aquí podrías cargar el estado de la conversación si usas un checkpointer con threadId
  // Por ahora, siempre empezamos con el estado inicial.

  const result = await agentApp.invoke(initialState, {
    configurable: { thread_id: threadId || Date.now().toString() },
  });

  const lastMessage = result.messages[result.messages.length - 1];
  if (lastMessage instanceof AIMessage) {
    return lastMessage.content as string;
  }
  return "No se pudo obtener una respuesta del agente.";
}
