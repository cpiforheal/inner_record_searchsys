# 病案室书架可视化索引 Demo

这是一个本地部署方向的 React Demo，用于验证“纸质病历不重排，只记录病历所在位置”的交互方式。

## 当前功能

- 五个实体档案柜的可视化还原
- 柜内按“行 / 摞”展示病案位置
- 点击任意摞位，右侧显示该位置的病历清单
- 支持按姓名、住院号、位置编码、出院日期搜索
- 支持在 Demo 中切换“借出 / 在架”状态
- `docs/sqlite-schema.sql` 提供后续接 SQLite 的表结构草案

## 本地运行

```bash
npm install --cache ./.npm-cache
npm run dev -- --port 4173
```

浏览器打开：

```text
http://127.0.0.1:4173/
```

## 后续接 SQLite 的建议

第一阶段只落地四类数据：

- `archive_locations`：柜号、行号、摞号、年月标签
- `medical_record_index`：姓名、住院号、出院日期、位置、第几本、状态
- `borrow_logs`：借阅、归还、用途、经办人
- `audit_logs`：查询、修改、导出等操作留痕

正式环境建议只在院内局域网运行，不开放公网访问。
