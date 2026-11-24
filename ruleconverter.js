#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

function renderYaml(source, content) {
  let hasRules = false
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()

  const body = lines.map((line, index) => {
    const rule = line.trim()
    if (!rule) return ''
    if (rule.startsWith('#')) {
      if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ufffe\uffff]/.test(rule)) {
        throw new Error(`${source}:${index + 1}: 注释包含 YAML 不支持的字符`)
      }
      return `  ${rule}`
    }

    const [type, value] = rule.split(',', 2)
    if (!value?.trim() || !type.trim()) {
      throw new Error(`${source}:${index + 1}: 规则必须包含类型和匹配值`)
    }

    hasRules = true
    // 引用整个字符串，避免 #、冒号等字符被解释为 YAML 语法。
    const scalar = JSON.stringify(rule).replace(/[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g, char =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    return `  - ${scalar}`
  })

  return [hasRules ? 'payload:' : 'payload: []', ...body, ''].join('\n')
}

function syncRules(srcDir, destDir) {
  const outputs = new Map()
  const names = new Set()
  const decoder = new TextDecoder('utf-8', { fatal: true })

  // 先校验完整输入；任何规则无效时，不修改现有的 YAML。
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (path.extname(entry.name) !== '.list' || entry.isDirectory()) continue
    const source = path.join(srcDir, entry.name)
    if (!entry.isFile()) throw new Error(`${source}: 不是普通文件`)

    const name = `${path.basename(entry.name, '.list')}.yaml`
    const key = name.normalize('NFC').toLowerCase()
    if (names.has(key)) throw new Error(`${source}: 输出文件名冲突（忽略大小写）`)
    names.add(key)

    const bytes = fs.readFileSync(source)
    let content
    try {
      content = decoder.decode(bytes)
    } catch (error) {
      throw new Error(`${source}: 无效的 UTF-8`, { cause: error })
    }
    outputs.set(name, renderYaml(source, content))
  }

  fs.mkdirSync(destDir, { recursive: true })
  const existing = new Set()
  for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (path.extname(entry.name) !== '.yaml') continue
    const target = path.join(destDir, entry.name)
    if (entry.isFile() && outputs.has(entry.name)) {
      existing.add(entry.name)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // 删除旧拼写后再创建新文件，兼容大小写不敏感的文件系统。
      fs.unlinkSync(target)
      console.log(`删除 ${target}`)
    }
  }

  for (const [name, content] of outputs) {
    const target = path.join(destDir, name)
    if (existing.has(name) && fs.readFileSync(target, 'utf8') === content) continue
    fs.writeFileSync(target, content)
    console.log(`生成 ${target}`)
  }
}

try {
  const [, , srcDir, destDir] = process.argv
  if (!srcDir || !destDir) throw new Error('用法: node ruleconverter.js <list 目录> <yaml 目录>')
  syncRules(srcDir, destDir)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
