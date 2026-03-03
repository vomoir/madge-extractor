#!/usr/bin/env node
import path from "path";
import fs, { rmSync } from "fs";
import madge from "madge";
import { exec } from "child_process";

// --- Alias Helper Functions ---
const stripComments = (text) => {
  return text.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
};

const findProjectRoot = (startPath) => {
  let currentDir = startPath;
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return startPath;
};

const getSourceAliases = (startPath) => {
  let currentDir = startPath;
  let foundPath = null;
  const configFiles = ["aliases.json", "jsconfig.json", "tsconfig.json"];

  while (currentDir !== path.parse(currentDir).root) {
    for (const file of configFiles) {
      const checkPath = path.join(currentDir, file);
      if (fs.existsSync(checkPath)) {
        foundPath = checkPath;
        break;
      }
    }
    if (foundPath) break;
    currentDir = path.dirname(currentDir);
  }

  if (!foundPath) {
    return {};
  }

  try {
    const rawContent = fs.readFileSync(foundPath, "utf8");
    const config = JSON.parse(stripComments(rawContent));
    const configDir = path.dirname(foundPath);
    const aliases = {};

    const fileName = path.basename(foundPath);
    if (fileName === "aliases.json") {
      Object.entries(config).forEach(([alias, target]) => {
        const cleanTarget = target.replace(/^[\\\/]/, "");
        aliases[alias] = path.resolve(configDir, cleanTarget);
      });
    } else {
      const paths = config?.compilerOptions?.paths;
      if (paths) {
        Object.entries(paths).forEach(([key, values]) => {
          const alias = key.replace(/\/\*$/, "");
          let target = values[0].replace(/\/\*$/, "");
          const cleanTarget = target.replace(/^[\\\/]/, "");
          aliases[alias] = path.resolve(configDir, cleanTarget);
        });
      }
    }
    return aliases;
  } catch (err) {
    return {};
  }
};

const tryAlias = (normalizedPath, aliasMap) => {
  const sortedAliases = Object.entries(aliasMap).sort(
    (a, b) => b[1].length - a[1].length,
  );

  for (const [alias, target] of sortedAliases) {
    const normalizedTarget = target.replace(/^\.\/|\/$/g, "");

    const isMatch =
      normalizedTarget === "" ||
      normalizedPath === normalizedTarget ||
      normalizedPath.startsWith(normalizedTarget + "/");

    if (isMatch) {
      let remaining = normalizedPath.slice(normalizedTarget.length);
      if (remaining.startsWith("/")) remaining = remaining.slice(1);

      let newImport = alias;

      if (remaining) {
        if (newImport.endsWith("/")) {
          newImport += remaining;
        } else {
          newImport += "/" + remaining;
        }
      }

      if (newImport !== "@/") {
        newImport = newImport.replace(/\/+/g, "/");
      }

      if (newImport.length > alias.length && newImport.endsWith("/")) {
        newImport = newImport.slice(0, -1);
      }

      return newImport;
    }
  }
  return null;
};

// --- Copied from saveMadgeReports.js ---
const saveMadgeReports = async (res, outputDir, baseName) => {
  // 1. Generate Markdown Content
  const deps = res.obj();
  const circular = res.circular();
  const date = new Date().toLocaleDateString();

  let markdown = "# Dependency Report: " + baseName + "\n";

  markdown += "*Generated on " + date + "*\n\n";

  markdown += "## Summary\n";
  markdown += "* **Total Files:** " + Object.keys(deps).length + "\n";

  markdown +=
    "* **Circular Dependencies:** " +
    (circular.length > 0 ? "⚠️ " + circular.length : "✅ None") +
    "\n\n";

  markdown += "## Dependency Details\n";
  markdown += "| File | Depends On |\n";
  markdown += "| :--- | :--- |\n";

  Object.entries(deps).forEach(function ([file, childDeps]) {
    const depList =
      childDeps.length > 0
        ? childDeps
            .map(function (d) {
              return "`" + d + "`";
            })
            .join(", ")
        : "_None_";

    markdown += "| `" + file + "` | " + depList + " |\n";
  });

  // 2. Prepare Paths
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, baseName + ".json");
  const mdPath = path.join(outputDir, baseName + ".md");

  // 3. Write Files
  fs.writeFileSync(jsonPath, JSON.stringify(deps, null, 2));
  fs.writeFileSync(mdPath, markdown);

  return { jsonPath, mdPath };
};

const syncDependencies = (absolutePaths, sourceRoot, targetDir, aliasMap = {}) => {
  let copiedCount = 0;
  let missingCount = 0;

  absolutePaths.forEach((srcPath) => {
    try {
      if (!fs.existsSync(srcPath)) {
        console.error("File missing (skipped): " + srcPath);
        missingCount++;
        return;
      }

      const relativePart = path.relative(sourceRoot, srcPath).replace(/\\/g, "/");
      let destPath = path.join(targetDir, relativePart);
      let content = fs.readFileSync(srcPath, "utf8");
      let isReactFile = false;

      if (srcPath.endsWith(".js")) {
        isReactFile =
          /import.*React/i.test(content) ||
          /<[A-Z]/.test(content) ||
          /return\s*\(/.test(content);
        if (isReactFile) {
          destPath = destPath.replace(/\.js$/, ".jsx");
        }
      }

      const importRegex = /(from|import|export)([\s\S]*?)(['"])([^'"]+)\3/g;

      if (srcPath.match(/\.(js|jsx|ts|tsx)$/)) {
        const currentFileDir = path.dirname(relativePart);

        content = content.replace(importRegex, (match, p1, p2, p3, p4) => {
          let importPath = p4;

          if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
            return match;
          }

          if (importPath.endsWith(".js")) {
            const resolvedAbs = path.resolve(path.dirname(srcPath), importPath);
            if (fs.existsSync(resolvedAbs)) {
              const subContent = fs.readFileSync(resolvedAbs, "utf8");
              if (/<[A-Z]/.test(subContent) || /import.*React/i.test(subContent)) {
                importPath = importPath.replace(/\.js$/, ".jsx");
              }
            }
          }

          const normalizedResolvedPath = path.posix.normalize(path.posix.join(currentFileDir, importPath));

          const aliased = tryAlias(normalizedResolvedPath, aliasMap);
          if (aliased) {
            return `${p1}${p2}${p3}${aliased}${p3}`;
          }

          return `${p1}${p2}${p3}${importPath}${p3}`;
        });
      }

      const destFolder = path.dirname(destPath);
      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true });
      }
      fs.writeFileSync(destPath, content);
      copiedCount++;
    } catch (err) {
      console.error("Failed to copy " + srcPath + ": " + err.message);
    }
  });

  console.log("\nFinal Sync Report:");
  console.log("✅ Copied: " + copiedCount);
  if (missingCount > 0) console.warn("⚠️ Missing: " + missingCount);
};

const findCommonBase = (files) => {
  if (files.length === 0) return "";

  const splitPaths = files.map((f) => f.split(path.sep));
  let common = splitPaths[0];

  for (let i = 1; i < splitPaths.length; i++) {
    let j = 0;
    while (
      j < common.length &&
      j < splitPaths[i].length &&
      common[j] === splitPaths[i][j]
    ) {
      j++;
    }
    common = common.slice(0, j);
  }
  return common.join(path.sep);
};

const rewriteImportsRecursive = (rootDirectory, currentDir, aliasMap, commonBase) => {
  const files = fs.readdirSync(currentDir);

  files.forEach((file) => {
    const fullPath = path.join(currentDir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
      rewriteImportsRecursive(rootDirectory, fullPath, aliasMap, commonBase);
    } else if (fullPath.match(/\.(js|jsx|ts|tsx)$/)) {
      let content = fs.readFileSync(fullPath, "utf8");

      const relativeToFile = path.relative(commonBase, fullPath).replace(/\\/g, "/");
      const relativeToRoot = path.dirname(relativeToFile);

      const importRegex = /(from|import|export)([\s\S]*?)(['"])([^'"]+)\3/g;

      const newContent = content.replace(importRegex, (match, p1, p2, p3, p4) => {
        let importPath = p4;

        if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
          return match;
        }

        const normalizedResolvedPath = path.posix.normalize(path.posix.join(relativeToRoot, importPath));

        const aliased = tryAlias(normalizedResolvedPath, aliasMap);
        if (aliased) {
          return `${p1}${p2}${p3}${aliased}${p3}`;
        }

        return match;
      });

      if (newContent !== content) {
        fs.writeFileSync(fullPath, newContent);
      }
    }
  });
};

const rewriteImportsInDirectory = (directory, aliasMap, commonBase) => {
  if (Object.keys(aliasMap).length === 0) return;
  rewriteImportsRecursive(directory, directory, aliasMap, commonBase);
};

const validateAliases = (targetDirectory) => {
  const results = {
    aliasesConfigured: false,
    aliasCount: 0,
    filesWithAliasedImports: 0,
    filesWithRelativeImports: 0,
    totalFilesScanned: 0,
    details: []
  };

  try {
    const jsconfigPath = path.join(targetDirectory, "jsconfig.json");
    if (!fs.existsSync(jsconfigPath)) {
      results.details.push("⚠️ No jsconfig.json found");
      return results;
    }

    const jsconfigContent = fs.readFileSync(jsconfigPath, "utf8");
    const jsconfig = JSON.parse(jsconfigContent);
    const aliases = jsconfig?.compilerOptions?.paths || {};
    const aliasKeys = Object.keys(aliases);

    results.aliasesConfigured = aliasKeys.length > 0;
    results.aliasCount = aliasKeys.length;

    if (results.aliasCount === 0) {
      results.details.push("⚠️ No aliases configured in jsconfig.json");
      return results;
    }

    results.details.push("✅ Found " + results.aliasCount + " aliases configured:");
    aliasKeys.forEach((alias) => {
      results.details.push("   " + alias + " -> " + aliases[alias][0]);
    });

    const scanDirectory = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.lstatSync(fullPath);

        if (stat.isDirectory() && !["node_modules", "dist", ".storybook"].includes(file)) {
          scanDirectory(fullPath);
        } else if (stat.isFile() && fullPath.match(/\.(js|jsx|ts|tsx)$/)) {
          results.totalFilesScanned++;
          const content = fs.readFileSync(fullPath, "utf8");

          const aliasedImports = [];
          aliasKeys.forEach((alias) => {
            const cleanAlias = alias.replace(/\/\*$/, "");
            if (new RegExp("from\\s+['\"]" + cleanAlias + "[/'\"]").test(content)) {
              aliasedImports.push(cleanAlias);
            }
          });

          if (aliasedImports.length > 0) {
            results.filesWithAliasedImports++;
          }

          if (/from\s+['"]\.\.?\//g.test(content)) {
            results.filesWithRelativeImports++;
          }
        }
      });
    };

    scanDirectory(targetDirectory);

    results.details.push("\n📊 Import Analysis:");
    results.details.push("   Files scanned: " + results.totalFilesScanned);
    results.details.push("   Using aliases: " + results.filesWithAliasedImports);
    if (results.filesWithRelativeImports > 0) {
      results.details.push("   Still using relative: " + results.filesWithRelativeImports);
    }

    if (results.filesWithAliasedImports > 0) {
      results.details.push("\n✨ Aliases are working!");
    } else if (results.filesWithRelativeImports > 0) {
      results.details.push("\n⚠️ Aliases configured but not yet used in imports");
    }

  } catch (err) {
    results.details.push("❌ Validation error: " + err.message);
  }

  return results;
};

const generateAliasesFromStructure = (commonBase, absolutePaths) => {
  const aliases = {};
  const dirCounts = {};

  absolutePaths.forEach((filePath) => {
    const relative = path.relative(commonBase, filePath).replace(/\\/g, "/");
    const parts = relative.split("/");
    if (parts.length > 1) {
      const firstDir = parts[0];
      dirCounts[firstDir] = (dirCounts[firstDir] || 0) + 1;
    }
  });

  Object.entries(dirCounts).forEach(([dir, count]) => {
    if (count >= 2) {
      const dirPath = path.resolve(commonBase, dir);
      if (fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory()) {
        aliases["@" + dir] = dirPath;
      }
    }
  });

  return aliases;
};

const generateJsconfigJson = (aliasMap) => {
  const paths = {};

  Object.entries(aliasMap).forEach(([alias, target]) => {
    const cleanAlias = alias.replace(/\/\*$/, "");
    const cleanTarget = target.replace(/^\.\/|\/$/g, "");

    paths[cleanAlias + "/*"] = ["./" + (cleanTarget ? cleanTarget + "/" : "") + "*"];
    paths[cleanAlias] = ["./" + (cleanTarget ? cleanTarget : ".")];
  });

  return {
    compilerOptions: {
      baseUrl: ".",
      paths: paths
    },
    exclude: ["node_modules", "dist"]
  };
};

// --- Main Execution Logic ---
async function run() {
  const args = process.argv.slice(2);
  const sourcePath = args[0];
  const outputPath = args[1];

  if (!sourcePath || !outputPath) {
    console.error(
      "Usage: node dependency-extractor.js <sourcePath> <outputPath>",
    );
    process.exit(1);
  }

  if (!fs.existsSync(sourcePath)) {
    console.error("File not found: " + sourcePath);
    return;
  }

  const componentName = path.parse(sourcePath).name;
  const finalTarget = path.join(outputPath, componentName);

  if (fs.existsSync(finalTarget)) {
    console.log("🧹 Cleaning up old extraction at " + finalTarget + "...");
    try {
      rmSync(finalTarget, { recursive: true, force: true });
    } catch (err) {
      console.error("\n❌ Could not clean up " + finalTarget);
      console.error("   " + err.message);
      if (err.code === "EPERM" || err.code === "EACCES") {
        console.error(
          "   💡 You may not have write permissions for this folder.",
        );
      }
      process.exit(1);
    }
  }

  console.log("🚀 Analyzing " + componentName + "...");
  try {
    const res = await madge(sourcePath, {
      baseDir: path.dirname(sourcePath),
    });

    const madgeObj = res.obj();
    const absoluteList = [path.resolve(sourcePath)];
    const uniquePaths = new Set();
    uniquePaths.add(path.resolve(sourcePath));

    Object.entries(madgeObj).forEach(([file, deps]) => {
      const dir = path.dirname(sourcePath);
      absoluteList.push(path.resolve(dir, file));
      deps.forEach((d) => absoluteList.push(path.resolve(dir, d)));
    });

    const commonBase = findCommonBase(absoluteList);
    console.log("📍 Common Base identified: " + commonBase);

    const assetExtensions = [".css", ".scss", ".sass", ".svg", ".png", ".jpg"];
    const expandedList = new Set(absoluteList);

    absoluteList.forEach((filePath) => {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        const siblings = fs.readdirSync(dir);
        siblings.forEach((file) => {
          const ext = path.extname(file).toLowerCase();
          if (assetExtensions.includes(ext)) {
            expandedList.add(path.resolve(dir, file));
          }
        });
      }
    });

    const finalCopyList = Array.from(expandedList);
    console.log(
      "🎨 Added " +
        (finalCopyList.length - absoluteList.length) +
        " assets (CSS/SVGs) to the queue.",
    );

    // --- Parse & Normalize Aliases ---
    let rawAliasMap = {};

    // 1. Auto-detect from config files
    rawAliasMap = getSourceAliases(path.dirname(sourcePath));
    const detectedCount = Object.keys(rawAliasMap).length;
    if (detectedCount > 0) {
      console.log("🔍 Detected " + detectedCount + " aliases from config file.");
    } else {
      console.log("ℹ️ No aliases found in config files.");
    }

    // 2. Auto-generate aliases from folder structure if none were found
    if (Object.keys(rawAliasMap).length === 0) {
      rawAliasMap = generateAliasesFromStructure(commonBase, finalCopyList);
      const generatedCount = Object.keys(rawAliasMap).length;
      if (generatedCount > 0) {
        console.log("✨ Generated " + generatedCount + " aliases from folder structure.");
        Object.entries(rawAliasMap).forEach(([alias, target]) => {
          console.log("   " + alias + " -> " + target);
        });
      }
    }

    // 3. Normalize all alias targets relative to commonBase
    const aliasMap = {};
    for (const [alias, absoluteTarget] of Object.entries(rawAliasMap)) {
      let relTarget = path
        .relative(commonBase, absoluteTarget)
        .replace(/\\/g, "/");

      if (relTarget.startsWith("..")) {
        console.log(
          "⚠️ Skipping alias '" + alias + "': target '" + relTarget + "' is outside common base.",
        );
        continue;
      }

      if (!relTarget || relTarget === ".") {
        relTarget = "";
      }
      aliasMap[alias] = relTarget;
    }

    const activeAliasCount = Object.keys(aliasMap).length;
    if (activeAliasCount > 0) {
      console.log("✨ " + activeAliasCount + " aliases active for import rewriting.");
      Object.entries(aliasMap).forEach(([alias, target]) => {
        console.log("   " + alias + " -> " + (target || "./"));
      });
    }

    // 4. Sync using the commonBase as the anchor
    syncDependencies(
      finalCopyList,
      commonBase,
      finalTarget,
      aliasMap,
    );

    // 5. Post-process: Rewrite imports in the entire extraction directory
    if (activeAliasCount > 0) {
      console.log("✨ Post-processing imports in " + finalTarget + "...");
      rewriteImportsInDirectory(finalTarget, aliasMap, commonBase);
    }

    await saveMadgeReports(res, finalTarget, componentName);

    console.log("✅ Reports saved to: " + finalTarget);

    // Generate and save jsconfig.json with aliases
    if (activeAliasCount > 0) {
      const jsconfigContent = generateJsconfigJson(aliasMap);
      const jsconfigPath = path.join(finalTarget, "jsconfig.json");
      fs.writeFileSync(jsconfigPath, JSON.stringify(jsconfigContent, null, 2));
      console.log("✅ jsconfig.json generated with " + activeAliasCount + " aliases.");
    }

    // Validate aliases
    const validationResults = validateAliases(finalTarget);
    if (validationResults.details.length > 0) {
      console.log("\n" + "=".repeat(40));
      console.log("🔍 ALIAS VALIDATION REPORT");
      console.log("=".repeat(40));
      validationResults.details.forEach((detail) => console.log(detail));
      console.log("=".repeat(40));
    }

    console.log("\n" + "=".repeat(40));
    console.log("🚀 EXTRACTION COMPLETE!");
    console.log("=".repeat(40));
    console.log("📍 Location: " + finalTarget);
    console.log("=".repeat(40));
    console.log("To view your component:");
    console.log('→   cd "' + finalTarget + '"');
    console.log("You may need to install missing dependencies manually.");
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") {
      console.error("\n❌ Permission denied while writing files!");
      console.error("   Destination: " + finalTarget);
      console.error(
        "   💡 Please check you have write access to this location.",
      );
      process.exit(1);
    }
    console.error("Failed to process reports: " + err.message);
  }
}

run();
