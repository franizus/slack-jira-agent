
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

/** * Función para realizar una petición SSE (Server-Sent Events)
 * @param url
 * @param options
 */
export async function fetchSse(url: string, options: FetchSseOptions): Promise<void> {
    const {onMessage, onError, ...fetchOptions} = options;

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
                const {done, value} = await reader.read();
                if (done) {
                    break; // El stream ha finalizado
                }

                // Decodificamos el chunk y lo añadimos al buffer
                buffer += decoder.decode(value, {stream: true});

                // Buscamos delimitadores de mensaje ('\n\n') en el buffer
                let boundaryIndex;
                while ((boundaryIndex = buffer.indexOf('\n\n')) >= 0) {
                    const message = buffer.substring(0, boundaryIndex);
                    buffer = buffer.substring(boundaryIndex + 2); // Eliminamos el mensaje procesado del buffer

                    if (message.startsWith(':')) { // Es un comentario, lo ignoramos
                        continue;
                    }

                    const sseEvent: SseEvent = {data: ''};
                    const lines = message.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            // Si ya hay datos, se agrega una nueva línea (para datos multilínea)
                            if (sseEvent.data) sseEvent.data += '\n';
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