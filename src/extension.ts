import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const head = "json-schema-plus://abgox";
let isUpdatingSchemas = false;
const output = vscode.window.createOutputChannel("JSON Schema Plus", { log: true });

export function activate(context: vscode.ExtensionContext) {
    output.info("[json-schema-plus] Extension activated");

    const schemaProvider = new SchemaContentProvider();
    const providerRegistration =
        vscode.workspace.registerTextDocumentContentProvider(
            "json-schema-plus",
            schemaProvider
        );
    context.subscriptions.push(providerRegistration);

    // 配置变化监听
    let updateTimer: NodeJS.Timeout | undefined;
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("json-schema-plus")) {
            clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                updateSchemaAssociations(schemaProvider);
            }, 300);
        }
    });
    context.subscriptions.push(configWatcher);

    // 监听窗口焦点变化
    const focusWatcher = vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
            output.info("[json-schema-plus] Window focused — checking schema associations...");
            updateSchemaAssociations(schemaProvider);
        }
    });
    context.subscriptions.push(focusWatcher);

    // 初始化
    updateSchemaAssociations(schemaProvider);
}

async function updateSchemaAssociations(schemaProvider: SchemaContentProvider) {
    if (isUpdatingSchemas) {
        output.info("[json-schema-plus] updateSchemaAssociations already running, skip.");
        return;
    }
    isUpdatingSchemas = true;

    try {
        const currentLanguage = vscode.env.language;
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const hasSavedWorkspace = !!vscode.workspace.workspaceFile;
        const target = hasSavedWorkspace
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;

        const collectedPluginSchemas: any[] = [];

        // 从每个工作区文件夹收集插件配置
        for (const folder of workspaceFolders) {
            const folderConfig = vscode.workspace.getConfiguration("json-schema-plus", folder.uri);
            const folderSchemas = folderConfig.get<any[]>("schemas", []);
            for (const schema of folderSchemas) {
                const { fileMatch, url, urls } = schema;
                if (!fileMatch) { continue; }

                let resolvedUrl = findBestMatchingSchema(currentLanguage, urls, url);
                if (!resolvedUrl) { continue; }

                resolvedUrl = resolvePath(resolvedUrl);
                const schemaUri = vscode.Uri.parse(
                    `${head}?lang=${currentLanguage}&url=${encodeURIComponent(resolvedUrl)}`
                );
                collectedPluginSchemas.push({ fileMatch, url: schemaUri.toString() });
            }
        }

        const jsonConfig = vscode.workspace.getConfiguration("json");
        const inspected = jsonConfig.inspect<any[]>("schemas");

        // 分别取出各层级配置
        const globalSchemas = inspected?.globalValue ?? [];
        const workspaceSchemas = inspected?.workspaceValue ?? [];

        // 当前层级实际生效配置（用于 diff）
        const effectiveSchemas = inspected?.workspaceValue
            ?? inspected?.globalValue
            ?? inspected?.defaultValue
            ?? [];

        // 仅保留工作区原有的用户自定义 schema（非插件生成）
        const workspaceUserSchemas = hasSavedWorkspace
            ? workspaceSchemas.filter(s => !isSchemaPlusAssociation(s))
            : [];

        // 临时工作区或单项目：继承全局的非插件 schema + 插件 schema
        const globalUserSchemas = !hasSavedWorkspace
            ? globalSchemas.filter(s => !isSchemaPlusAssociation(s))
            : [];

        const mergedSchemas = hasSavedWorkspace
            ? [...workspaceUserSchemas, ...collectedPluginSchemas]
            : [...globalUserSchemas, ...collectedPluginSchemas];

        const shouldUpdate = stableStringify(mergedSchemas) !== stableStringify(effectiveSchemas);

        if (shouldUpdate) {
            await jsonConfig.update("schemas", mergedSchemas, target);
            output.info(`[json-schema-plus] Updated json.schemas in ${hasSavedWorkspace ? "workspace" : "global"} settings.json`);
        } else {
            output.info("[json-schema-plus] No schema changes detected.");
        }

        // 刷新 provider
        const updatedUrls = collectedPluginSchemas.map(s => s.url);
        schemaProvider.refresh(updatedUrls);

    } catch (err) {
        output.error(`[json-schema-plus] Failed to update schema associations: ${String(err)}`);
        vscode.window.showErrorMessage(
            `[json-schema-plus] Failed to update schemas: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        isUpdatingSchemas = false;
    }
}


function isSchemaPlusAssociation(schema: any): boolean {
    return !!(schema && schema.url && schema.url.startsWith(head));
}

function stableStringify(obj: any): string {
    try {
        return JSON.stringify(sortKeys(obj));
    } catch (e) {
        output.error(`[json-schema-plus] stableStringify failed: ${String(e)}`);
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

function resolvePath(p: string): string {
    if (!p) { return p; }
    if (p.startsWith("http")) { return p; }

    if (p.startsWith("file:")) {
        try {
            return vscode.Uri.parse(p).fsPath;
        } catch {
            return p.replace(/^file:\/*/, "");
        }
    }

    if (path.isAbsolute(p)) { return p; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length) {
        const root = workspaceFolders[0].uri.fsPath;
        if (p.startsWith("/")) {
            return path.join(root, p);
        }
        return path.resolve(root, p);
    }
    return path.resolve(p);
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

class SchemaContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _providedUris = new Set<string>();

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        let query: URLSearchParams;
        try {
            query = new URLSearchParams(uri.query);
        } catch {
            output.warn("[json-schema-plus] Invalid URI query detected");
            return JSON.stringify({});
        }

        const schemaUrl = query.get("url");
        if (!schemaUrl) {
            output.warn("[json-schema-plus] No schema URL provided in URI");
            return JSON.stringify({});
        }

        this._providedUris.add(uri.toString());

        try {
            if (schemaUrl.startsWith("http://") || schemaUrl.startsWith("https://")) {
                output.info(`[json-schema-plus] Fetching remote schema: ${schemaUrl}`);
                return this.fetchRemoteSchema(schemaUrl);
            }

            const filePath = schemaUrl.startsWith("file:")
                ? vscode.Uri.parse(schemaUrl).fsPath
                : schemaUrl;

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf8");
                output.info(`[json-schema-plus] Loaded local schema: ${filePath}`);
                return content;
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    const potential = path.join(folder.uri.fsPath, schemaUrl);
                    if (fs.existsSync(potential)) {
                        output.info(`[json-schema-plus] Found schema in workspace: ${potential}`);
                        return fs.readFileSync(potential, "utf8");
                    }
                }
            }

            return JSON.stringify({ error: "Schema file not found", filePath });
        } catch (error) {
            output.error(`[json-schema-plus] Error providing schema content: ${String(error)}`);
            return JSON.stringify({
                error: "Unexpected error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async fetchRemoteSchema(url: string): Promise<string> {
        try {
            const response = await fetch(url);
            if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
            const content = await response.text();
            return content;
        } catch (error) {
            output.error(`[json-schema-plus] Failed to fetch remote schema ${url}: ${String(error)}`);
            return JSON.stringify({
                error: "Failed to fetch remote schema",
                url,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    refresh(urls?: string[]) {
        const targets = urls && urls.length ? urls : Array.from(this._providedUris);
        for (const u of targets) {
            try {
                this._onDidChange.fire(vscode.Uri.parse(u));
            } catch { /* ignore invalid URIs */ }
            this._providedUris.delete(u);
        }
    }
}

export function deactivate() {
    output.info("[json-schema-plus] Extension deactivated");
}
