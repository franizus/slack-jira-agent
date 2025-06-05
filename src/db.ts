import { MongoClient, Db, Collection } from "mongodb";

const mongoDbUri = process.env.MONGODB_URI;
export const DB_NAME = "slack-jira-agent"; // Puede ser exportado si se necesita en otros lugares
const PROCESSED_EVENTS_COLLECTION = "slack_processed_events";
const TTL_INDEX_NAME = "processed_at_ttl_index";
const EVENT_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // 7 días

let mongoClient: MongoClient | undefined;
let indexEnsured = false;

async function ensureProcessedEventsIndex(db: Db): Promise<void> {
  if (indexEnsured) return;

  try {
    const collection: Collection = db.collection(PROCESSED_EVENTS_COLLECTION);
    const indexExists = await collection.indexExists(TTL_INDEX_NAME);

    if (!indexExists) {
      await collection.createIndex(
        { processed_at: 1 },
        { name: TTL_INDEX_NAME, expireAfterSeconds: EVENT_EXPIRATION_SECONDS },
      );
      console.log(
        `Índice TTL "${TTL_INDEX_NAME}" creado en la colección "${PROCESSED_EVENTS_COLLECTION}" con expiración de ${EVENT_EXPIRATION_SECONDS} segundos.`,
      );
    }
    indexEnsured = true;
  } catch (error) {
    console.error(
      `Error al asegurar el índice TTL en "${PROCESSED_EVENTS_COLLECTION}":`,
      error,
    );
    // No bloqueamos la app por esto, pero es importante loguearlo.
    // indexEnsured se mantiene false para reintentar en la próxima conexión.
  }
}

export async function getMongoClient(): Promise<MongoClient | undefined> {
  if (!mongoDbUri) {
    console.warn(
      "MONGODB_URI no está configurada. Las operaciones de base de datos no funcionarán.",
    );
    return undefined;
  }

  if (mongoClient) {
    // Aquí podríamos añadir una comprobación de 'ping' si fuera necesario para asegurar que la conexión está viva.
    // Por ahora, si está instanciado, lo devolvemos.
    return mongoClient;
  }

  try {
    console.log("Creando nueva instancia y conectando a MongoDB...");
    const newClient = new MongoClient(mongoDbUri);
    await newClient.connect();
    mongoClient = newClient; // Asignar solo después de una conexión exitosa
    console.log("Conectado a MongoDB.");

    // Asegurar el índice TTL después de conectar
    const db = mongoClient.db(DB_NAME);
    await ensureProcessedEventsIndex(db);

    return mongoClient;
  } catch (error) {
    console.error("Error al conectar con MongoDB:", error);
    mongoClient = undefined; // Asegurarse de que no se use un cliente fallido
    return undefined;
  }
}

export async function isEventProcessed(eventId: string): Promise<boolean> {
  const client = await getMongoClient();
  if (!client) return false;

  try {
    const db: Db = client.db(DB_NAME);
    const collection = db.collection(PROCESSED_EVENTS_COLLECTION);
    const existingEvent = await collection.findOne({ event_id: eventId });
    return !!existingEvent;
  } catch (error) {
    console.error(
      `Error al verificar si el evento ${eventId} fue procesado:`,
      error,
    );
    return false;
  }
}

export async function markEventAsProcessed(eventId: string): Promise<void> {
  const client = await getMongoClient();
  if (!client) return;

  try {
    const db: Db = client.db(DB_NAME);
    const collection = db.collection(PROCESSED_EVENTS_COLLECTION);
    await collection.insertOne({ event_id: eventId, processed_at: new Date() });
    console.log(`Evento ${eventId} marcado como procesado.`);
  } catch (error) {
    console.error(
      `Error al marcar el evento ${eventId} como procesado:`,
      error,
    );
  }
}

// Opcional: Función para cerrar la conexión, útil para scripts o pruebas,
// pero en Lambdas a menudo se deja que el runtime maneje el ciclo de vida.
export async function closeMongoClient(): Promise<void> {
  if (mongoClient) {
    try {
      await mongoClient.close();
      mongoClient = undefined;
      indexEnsured = false; // Para que se re-verifique el índice si se reconecta
      console.log("Conexión a MongoDB cerrada.");
    } catch (error) {
      console.error("Error al cerrar la conexión de MongoDB:", error);
    }
  }
}
