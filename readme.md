<h1 align="center">✨ <a href="https://json-schema-plus.abgox.com">json-schema-plus</a> ✨</h1>

<p align="center">
    <a href="https://github.com/abgox/json-schema-plus/blob/main/license">
        <img src="https://img.shields.io/github/license/abgox/json-schema-plus" alt="license" />
    </a>
    <a href="https://github.com/abgox/json-schema-plus">
        <img src="https://img.shields.io/github/v/release/abgox/json-schema-plus?label=version" alt="version" />
    </a>
    <a href="https://github.com/abgox/json-schema-plus">
        <img src="https://img.shields.io/github/languages/code-size/abgox/json-schema-plus" alt="code size" />
    </a>
    <a href="https://github.com/abgox/json-schema-plus">
        <img src="https://img.shields.io/github/repo-size/abgox/json-schema-plus" alt="repo size" />
    </a>
    <a href="https://github.com/abgox/json-schema-plus">
        <img src="https://img.shields.io/github/created-at/abgox/json-schema-plus" alt="created" />
    </a>
    <a href="https://marketplace.visualstudio.com/items?itemName=abgox.json-schema-plus">
        <img src="https://img.shields.io/visual-studio-marketplace/d/abgox.json-schema-plus" alt="download" />
    </a>
</p>

---

<p align="center">
  <strong>Star ⭐️ or <a href="https://abgox.com/donate">Donate 💰</a> if you like it!</strong>
</p>

[简体中文](./readme.zh-CN.md) | [English](./readme.md) | [Github](https://github.com/abgox/json-schema-plus) | [Gitee](https://gitee.com/abgox/json-schema-plus)

<img src="./icon.png" alt="logo" width="128px" />

An extension for [Visual Studio Code](https://code.visualstudio.com/) that provides multilingual dynamic schema matching for JSON Schema.

## How to Use

> [!Tip]
>
> Take `scoop-manifest.*.json` in [abgox/schema](https://schema.abgox.com) as an example.

1. [Install json-schema-plus](https://marketplace.visualstudio.com/items?itemName=abgox.json-schema-plus).

2. Add the following configuration to your workspace [settings.json](https://code.visualstudio.com/docs/configure/settings) file, refer to [abgox/abyss](https://github.com/abgox/abyss/blob/main/.vscode/settings.json).
   ```json
   "json-schema-plus.schemas": [
    {
      "fileMatch": ["bucket/**/*.json"],
      "urls": [
        {
          "language": "zh",
          "url": "https://schema.abgox.com/scoop-manifest.zh-CN.json"
        },
      ],
      "url": "https://schema.abgox.com/scoop-manifest.en-US.json"
    }
   ]
   ```
3. It will automatically load the corresponding Schema structure according to the current language environment.
   - If it is `zh-CN`.
     - It will match `zh` in `urls`.
     - Then it will load `https://schema.abgox.com/scoop-manifest.zh-CN.json`.
   - If it is `en-US`.
     - There is no relevant definition in `urls`.
     - Then it will load `"https://schema.abgox.com/scoop-manifest.en-US.json"`.
