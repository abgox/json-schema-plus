import * as vscode from "vscode";

let isUpdatingSchemas = false;
let updateTimer: ReturnType<typeof setTimeout> | undefined;
const output = vscode.window.createOutputChannel("JSON Schema Plus", { log: true });

export function activate(context: vscode.ExtensionContext) {
    output.info("Extension activated");

    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("json-schema-plus")) {
            clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                updateSchemaAssociations();
            }, 300);
        }
    });
    context.subscriptions.push(configWatcher);

    const focusWatcher = vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
            output.info("Window focused — checking schema associations...");
            updateSchemaAssociations();
        }
    });
    context.subscriptions.push(focusWatcher);

    const folderWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        output.info("Workspace folders changed — updating schema associations...");
        updateSchemaAssociations();
    });
    context.subscriptions.push(folderWatcher);

    updateSchemaAssociations();
}

async function updateSchemaAssociations() {
    if (isUpdatingSchemas) {
        output.info("updateSchemaAssociations already running, skip.");
        return;
    }
    isUpdatingSchemas = true;

    try {
        const currentLanguage = resolveLanguage();
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const hasSavedWorkspace = !!vscode.workspace.workspaceFile;
        const target = hasSavedWorkspace
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;

        const collectedPluginSchemas: any[] = [];

        for (const folder of workspaceFolders) {
            const folderConfig = vscode.workspace.getConfiguration("json-schema-plus", folder.uri);
            const folderSchemas = folderConfig.get<any[]>("schemas", []);
            for (const schema of folderSchemas) {
                const { fileMatch, url, urls } = schema;
                if (!fileMatch) { continue; }

                const resolvedUrl = findBestMatchingSchema(currentLanguage, urls, url);
                if (!resolvedUrl) { continue; }

                const schemaUri = toSchemaUri(resolvedUrl);

                collectedPluginSchemas.push({ fileMatch, url: schemaUri, '__generated_by_abgox-json-schema-plus': true });
            }
        }

        const jsonConfig = vscode.workspace.getConfiguration("json");
        const inspected = jsonConfig.inspect<any[]>("schemas");

        const globalSchemas = inspected?.globalValue ?? [];
        const workspaceSchemas = inspected?.workspaceValue ?? [];

        const effectiveSchemas = inspected?.workspaceValue
            ?? inspected?.globalValue
            ?? inspected?.defaultValue
            ?? [];

        const workspaceUserSchemas = hasSavedWorkspace
            ? workspaceSchemas.filter(s => !isSchemaPlusAssociation(s))
            : [];

        const globalUserSchemas = !hasSavedWorkspace
            ? globalSchemas.filter(s => !isSchemaPlusAssociation(s))
            : [];

        const mergedSchemas = hasSavedWorkspace
            ? [...workspaceUserSchemas, ...collectedPluginSchemas]
            : [...globalUserSchemas, ...collectedPluginSchemas];

        const shouldUpdate = stableStringify(mergedSchemas) !== stableStringify(effectiveSchemas);

        if (shouldUpdate) {
            await jsonConfig.update("schemas", mergedSchemas, target);
            output.info(`Updated json.schemas in ${hasSavedWorkspace ? "workspace" : "global"} settings.json`);
        } else {
            output.info("No schema changes detected.");
        }

    } catch (err) {
        output.error(`Failed to update schema associations: ${String(err)}`);
        vscode.window.showErrorMessage(
            `Failed to update schemas: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        isUpdatingSchemas = false;
    }
}

function isSchemaPlusAssociation(schema: any): boolean {
    if (!schema || !schema.url) {
        return false;
    }
    return schema['__generated_by_abgox-json-schema-plus'] || schema.url.startsWith("json-schema-plus://abgox");
}

function stableStringify(obj: any): string {
    try {
        return JSON.stringify(sortKeys(obj));
    } catch (e) {
        output.error(`stableStringify failed: ${String(e)}`);
        return "";
    }
}

function sortKeys(obj: any): any {
    if (Array.isArray(obj)) { return obj.map(sortKeys); }
    if (obj && typeof obj === "object") {
        return Object.keys(obj)
            .sort()
            .reduce((acc, key) => {
                acc[key] = sortKeys(obj[key]);
                return acc;
            }, {} as any);
    }
    return obj;
}

function toSchemaUri(resolvedUrl: string): string {
    if (resolvedUrl.startsWith("http://") || resolvedUrl.startsWith("https://")) {
        return resolvedUrl;
    }

    if (resolvedUrl.startsWith("file:")) {
        try {
            return vscode.Uri.parse(resolvedUrl).toString();
        } catch {
            return resolvedUrl;
        }
    }

    if (isAbsolute(resolvedUrl)) {
        try {
            return vscode.Uri.file(resolvedUrl).toString();
        } catch {
            return resolvedUrl;
        }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length) {
        try {
            return vscode.Uri.joinPath(workspaceFolders[0].uri, resolvedUrl).toString();
        } catch { }
    }

    return resolvedUrl;
}

function isAbsolute(p: string): boolean {
    if (p.startsWith("/")) { return true; }
    if (/^[a-zA-Z]:[\\\/]/.test(p)) { return true; }
    if (p.startsWith("\\\\")) { return true; }
    return false;
}

function findBestMatchingSchema(
    currentLanguage: string,
    urls?: Array<{ language: string; url: string }>,
    defaultUrl?: string
): string | undefined {
    if (!urls || urls.length === 0) { return defaultUrl; }

    const exactMatch = urls.find(
        (item) => item.language.toLowerCase() === currentLanguage.toLowerCase()
    );
    if (exactMatch) { return exactMatch.url; }

    const mainPart = currentLanguage.split("-")[0].toLowerCase();
    const mainPartMatch = urls.find(
        (item) => item.language.toLowerCase().split("-")[0] === mainPart
    );
    if (mainPartMatch) { return mainPartMatch.url; }

    return defaultUrl;
}

function resolveLanguage(): string {
    const vscodeLang = vscode.env.language;
    if (vscodeLang && vscodeLang !== "en") { return vscodeLang; }

    if (typeof navigator !== "undefined" && navigator.language) {
        return navigator.language;
    }

    return vscodeLang;
}

export function deactivate() {
    clearTimeout(updateTimer);
    output.info("Extension deactivated");
}
