import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const head = "json-schema-plus://abgox";

export function activate(context: vscode.ExtensionContext) {
    console.log("Schema Plus extension activated");

    // 创建自定义的 schema 内容提供者
    const schemaProvider = new SchemaContentProvider();
    const providerRegistration =
        vscode.workspace.registerTextDocumentContentProvider(
            "json-schema-plus",
            schemaProvider
        );
    context.subscriptions.push(providerRegistration);

    // 监听配置变化
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("json-schema-plus")) {
            updateSchemaAssociations();
            // 通知所有 schema 已更改
            schemaProvider.refresh();
        }
    });
    context.subscriptions.push(configWatcher);

    // 初始化时更新 schema 关联
    updateSchemaAssociations();
}

// 更新 schema 关联
function updateSchemaAssociations() {
    const currentLanguage = vscode.env.language;
    const config = vscode.workspace.getConfiguration("json-schema-plus");
    const schemas = config.get<any[]>("schemas", []);

    // 获取当前的 json.schemas 配置
    const jsonConfig = vscode.workspace.getConfiguration("json");
    const existingSchemas = jsonConfig.get<any[]>("schemas", []);

    // 分离出非 json-schema-plus 关联的配置
    const nativeSchemas = existingSchemas.filter((schema) => !isSchemaPlusAssociation(schema));

    // 基于当前 json-schema-plus 配置生成新的关联
    const newSchemaPlusSchemas: any[] = [];

    schemas.forEach((schema) => {
        const { fileMatch, url, urls } = schema;

        if (!fileMatch) {
            return;
        }

        // 根据当前语言找到最匹配的 schema 路径
        let resolvedUrl = findBestMatchingSchema(currentLanguage, urls, url);

        if (resolvedUrl) {
            resolvedUrl = resolvePath(resolvedUrl);

            const schemaUri = vscode.Uri.parse(`${head}?lang=${currentLanguage}&url=${encodeURIComponent(resolvedUrl!)}`);
            newSchemaPlusSchemas.push({
                fileMatch: fileMatch,
                url: schemaUri.toString()
            });
        } else {
            vscode.window.showErrorMessage(`No schema URL found for pattern ${fileMatch}`);
        }
    });

    // 合并配置：原有非 json-schema-plus 配置 + 新的 json-schema-plus 配置
    const mergedSchemas = [...nativeSchemas, ...newSchemaPlusSchemas];

    jsonConfig.update(
        "schemas",
        mergedSchemas,
        vscode.ConfigurationTarget.Global
    ).then(() => {
        console.log("Schema associations updated without affecting user configurations");
    });
}

/**
 * 判断是否为 json-schema-plus 管理的关联配置
 */
function isSchemaPlusAssociation(schema: any): boolean {
    if (!schema || !schema.url) {
        return false;
    }
    return schema.url.startsWith(head);
}

// 把相对路径转成绝对路径
function resolvePath(p: string): string {
    if (p.startsWith("http")) {
        return p;
    }
    if (vscode.workspace.workspaceFolders?.length) {
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        if (p.startsWith("./") || p.startsWith("../")) {
            return path.resolve(root, p);
        }
        return path.join(root, p);
    }
    return p;
}

// 根据当前语言找到最匹配的 schema 路径
function findBestMatchingSchema(
    currentLanguage: string,
    urls?: Array<{ language: string; path: string }>,
    defaultUrl?: string
): string | undefined {
    // 如果没有 urls 数组，直接返回默认 url
    if (!urls || urls.length === 0) {
        return defaultUrl;
    }

    // 精确匹配当前语言
    const exactMatch = urls.find(
        (item) => item.language.toLowerCase() === currentLanguage.toLowerCase()
    );
    if (exactMatch) {
        return exactMatch.path;
    }

    // 尝试匹配语言的主要部分（如 'zh-cn' 匹配 'zh'）
    const languageMainPart = currentLanguage.split("-")[0].toLowerCase();
    const mainPartMatch = urls.find(
        (item) => item.language.toLowerCase().split("-")[0] === languageMainPart
    );
    if (mainPartMatch) {
        return mainPartMatch.path;
    }

    // 最后返回默认 url
    return defaultUrl;
}

class SchemaContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        // 从 URI 查询参数中提取实际的 schema URL
        const query = new URLSearchParams(uri.query);
        const schemaUrl = query.get("url");

        if (!schemaUrl) {
            console.error("No schema URL provided in the URI");
            return JSON.stringify({});
        }

        try {
            // 处理 HTTP/HTTPS URL
            if (schemaUrl.startsWith("http://") || schemaUrl.startsWith("https://")) {
                console.log(`Attempting to fetch remote schema: ${schemaUrl}`);
                // 注意：在 VSCode 扩展中，我们应该使用 fetch API 或其他 HTTP 客户端
                // 由于这是同步操作，我们需要返回一个 Promise
                return this.fetchRemoteSchema(schemaUrl);
            }

            // 处理本地文件路径
            const filePath = schemaUrl.startsWith("file:")
                ? schemaUrl.slice(5)
                : schemaUrl;
            console.log(`Attempting to read local schema file: ${filePath}`);

            // 检查文件是否存在
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, "utf8");
                    console.log(`Successfully read schema file: ${filePath}`);
                    return content;
                } catch (readError) {
                    console.error(`Error reading schema file ${filePath}:`, readError);
                    // 返回详细的错误信息
                    return JSON.stringify({
                        error: "Failed to read schema file",
                        filePath: filePath,
                        message:
                            readError instanceof Error
                                ? readError.message
                                : String(readError),
                    });
                }
            } else {
                console.error(`Schema file not found: ${filePath}`);
                // 尝试在所有工作区文件夹中查找文件
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    for (const folder of workspaceFolders) {
                        const potentialPath = path.join(
                            folder.uri.fsPath,
                            schemaUrl.startsWith("/") ? schemaUrl.substring(1) : schemaUrl
                        );
                        if (fs.existsSync(potentialPath)) {
                            console.log(`Found schema file in workspace: ${potentialPath}`);
                            return fs.readFileSync(potentialPath, "utf8");
                        }
                    }
                }

                // 文件不存在，返回错误信息
                return JSON.stringify({
                    error: "Schema file not found",
                    filePath: filePath,
                });
            }
        } catch (error) {
            console.error("Error providing schema content:", error);
            return JSON.stringify({
                error: "Unexpected error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // 异步获取远程 schema
    private async fetchRemoteSchema(url: string): Promise<string> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const content = await response.text();
            console.log(`Successfully fetched remote schema: ${url}`);
            return content;
        } catch (error) {
            console.error(`Error fetching remote schema ${url}:`, error);
            return JSON.stringify({
                error: "Failed to fetch remote schema",
                url: url,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // 刷新所有 schema
    refresh() {
        this._onDidChange.fire(vscode.Uri.parse(`${head}*`));
    }
}

export function deactivate() {
    console.log("Schema Plus extension deactivated");
}
