#!/usr/bin/env node
import path from "path";
import fs, { rmSync } from "fs";
import madge from "madge";
import { exec } from "child_process";

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

// --- Copied from extractComponents.js ---
const syncDependencies = (absolutePaths, sourceRoot, targetDir) => {
  let copiedCount = 0;
  let missingCount = 0;

  absolutePaths.forEach((srcPath) => {
    try {
      // Check if file exists
      if (!fs.existsSync(srcPath)) {
        console.error("File missing (skipped): " + srcPath);
        missingCount++;
        return;
      }

      const relativePart = path.relative(sourceRoot, srcPath);
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
      const importRegex = /(from|import)\s+(['"])((\.\.?\/)+.*)\.js(['"])/g;
      if (srcPath.match(/\.(js|jsx)$/)) {
        content = content.replace(importRegex, (match, p1, p2, p3, p4, p5) => {
          return p1 + " " + p2 + p3 + ".jsx" + p5;
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

    syncDependencies(finalCopyList, commonBase, finalTarget);

    await saveMadgeReports(res, finalTarget, componentName);

    console.log("✅ Reports saved to: " + finalTarget);
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
