import fs from "fs"
import path from "path"
import { execSync } from 'child_process'

const outputFolder = "rollup"
const format = "vsix"

const config = JSON.parse(fs.readFileSync("package.json", "utf8"))
const version = config.version

if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder)
}
const currentTime = new Date().toLocaleString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: "2-digit"
}).replace(/[\/:]/g, "").replace(/ /g, "-")
const outputFileName = `OpenCML-Ext-${version}-${currentTime}.${format}`
const outputPath = path.join(outputFolder, outputFileName)

execSync("npm run build")
execSync("vsce package --out " + outputPath)

console.log(`Created ${outputPath}`)
console.log("Done")