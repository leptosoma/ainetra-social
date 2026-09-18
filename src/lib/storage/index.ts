import path from "node:path";
import { LocalStorageProvider } from "./local-storage";

const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_STORAGE_ROOT ?? ".data/uploads");
export const storage = new LocalStorageProvider(root);
export type { StorageProvider } from "./types";
