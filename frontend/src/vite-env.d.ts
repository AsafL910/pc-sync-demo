/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_DB_SYNC_URL: string
    readonly VITE_NATS_URL: string
    readonly VITE_NODE_NAME: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
