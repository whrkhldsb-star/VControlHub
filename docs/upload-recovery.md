# 分片上传最终提交恢复

普通文件和图片最终提交均持有唯一执行者标识，租约为 120 秒，每 15 秒续租。Worker 的 job-maintenance 扫描过期租约，将会话标为 FAILED、recoveryRequired=true，并保留分片、目标路径及已有恢复信息。Worker 停止时需要先恢复 Worker，回收不是独立系统定时器。

此过程不自动重试，不删除原文件、远端文件或临时分片。失联的远端写入可能晚于请求失败完成，所以“租约过期”不证明目标未被修改。旧执行者不能在会话回收后提交文件索引／图片记录；用户重新选中同一源文件时会看到结果待核对提示，不能自动创建另一会话覆盖目标。

数据库提交成功但响应丢失时，COMPLETED 会话继续保留成功结果，不会被过期回收改成失败。文件和数据库无法做跨系统原子事务，不能承诺所有网络故障均自动恢复为成功。

管理员在应用目录执行只读检查：

```bash
npm run upload:recovery -- list
```

该命令读取进程环境变量及当前 `.env`，最多列出 100 条待核对记录及历史无租约 FINALIZING 记录。输出包含内部路径，只供管理员保存。必须使用与运行服务相同的数据库配置；若 systemd 部署使用 `.env.runtime`，请改用以下命令，后续 acknowledge 也使用同一前缀：

```bash
node --env-file=.env.runtime --import tsx scripts/upload-recovery.ts list
node --env-file=.env.runtime --import tsx scripts/upload-recovery.ts acknowledge SESSION_ID ALL_WRITERS_STOPPED_AND_TARGET_REVIEWED
```

1. 先确认旧 Web 执行进程及对应远端传输已停止；必要时在维护窗口停止所有旧写入进程，不能只因为页面超时就认为写入已经停止。
2. 按 recoveryMetadata、storageNodeId、relativePath 和文件摘要核对目标、索引与图片记录。图片元数据包含原图和派生文件路径；它们可能只是计划路径，不代表每个文件都已写成。
3. 目标已完整写入时，可用原有目录同步／索引管理入口核对文件；没有一致结果时先保存副本，再决定是否由用户重传。图片及其派生文件由管理员核对后处理，工具不会自动补建记录。
4. 只有明确需要允许重传且上述核对完成时，执行：

```bash
npm run upload:recovery -- acknowledge SESSION_ID ALL_WRITERS_STOPPED_AND_TARGET_REVIEWED
```

这只清除待核对标记并保留失败记录及恢复材料，不直接启动上传、不覆盖文件。用户可以再次选择源文件启动新上传。仍在持有租约的 FINALIZING 和 COMPLETED 记录不能用该命令处理。旧版本的无租约记录不会自动判死，只有经过相同人工确认才允许处理。

确认恢复完成后由管理员按 session ID 清理保留的临时目录；不要对所有 FINALIZING 或 FAILED 记录实施统一 TTL 删除。部署此版本新增四个可空／有默认值字段及索引，不改动已有文件；旧程序不应与新程序同时执行同一个会话的最终提交。
