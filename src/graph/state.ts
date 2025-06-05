import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

// Definimos la interfaz para el estado de nuestro grafo.
// MessagesAnnotation es una forma conveniente de manejar una lista de mensajes
// que se acumulan durante la ejecución del grafo.
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y), // Concatena nuevos mensajes a los existentes
    default: () => [], // Valor inicial es un array vacío
  }),
  userName: Annotation<string | null>({
    // Si userName se establece una vez o se sobrescribe, este reducer es adecuado.
    // El valor actual (x) se ignora, y se toma el nuevo valor (y).
    reducer: (_currentValue, newValue) => newValue,
    default: () => null, // Valor inicial es null
  }),
});

export type AgentStateType = typeof AgentState.State;