# DedupStudio Backend

Flask 后端服务，提供照片去重的 CLIP 嵌入、感知哈希和分组计算能力。

## 环境要求

- Python 3.10+
- macOS (Apple Silicon M系列) 或 Linux
- 需要以下 Python 包

## 安装依赖

建议使用 Python 3.11 或更高版本。可通过 pyenv 或直接使用系统 Python 3。

```bash
cd /Users/demimute/.openclaw/workspace/agent3/dedup-studio/backend

# 创建虚拟环境（推荐）
python3.11 -m venv venv
source venv/bin/activate

# 安装依赖
pip install flask flask-cors torch open-clip-torch pillow imagehash
```

### 依赖说明

| 包 | 版本 | 用途 |
|---|---|---|
| flask | ^3.0.0 | Web 框架 |
| flask-cors | ^4.0.0 | CORS 支持 |
| torch | ^2.0.0 | 深度学习框架 |
| open-clip-torch | ^3.0.0 | CLIP 模型 |
| pillow | ^11.0.0 | 图像处理 |
| imagehash | ^4.3.0 | 感知哈希 |

### Apple Silicon (M1/M2/M3/M4) 特别说明

如果使用 Apple Silicon Mac，torch 会自动使用 MPS 加速，CLIP 计算会在 GPU 上运行，无需额外配置。

```bash
# 验证 MPS 是否可用
python3 -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
```

## 运行

```bash
# 激活虚拟环境后
python3.11 app.py
```

服务会在 `http://localhost:5000` 启动。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/scan | 扫描文件夹，返回图片列表 |
| POST | /api/embed | 计算 CLIP 嵌入向量 |
| POST | /api/hash | 计算感知哈希 (pHash) |
| POST | /api/groups | 计算相似分组 |
| POST | /api/move | 移动文件到去重目录 |
| POST | /api/undo | 撤销最近操作 |
| GET | /api/history | 获取操作历史 |
| POST | /api/clear_cache | 清除缓存 |

## 测试

### 启动后端

```bash
python3.11 backend/app.py
```

### 测试 /api/scan 接口

```bash
curl -X POST http://localhost:5000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Volumes/photo/照片"}'
```

### 测试完整流程

```bash
# 1. 扫描
curl -s -X POST http://localhost:5000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Volumes/photo/照片"}' | python3 -m json.tool

# 2. 计算嵌入（假设 images 返回了 ["a.jpg", "b.jpg"]）
curl -s -X POST http://localhost:5000/api/embed \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Volumes/photo/照片", "images": ["a.jpg", "b.jpg"]}' | python3 -m json.tool

# 3. 计算哈希
curl -s -X POST http://localhost:5000/api/hash \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Volumes/photo/照片", "images": ["a.jpg", "b.jpg"]}' | python3 -m json.tool

# 4. 获取分组
curl -s -X POST http://localhost:5000/api/groups \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Volumes/photo/照片", "strategy": "clip", "threshold": 0.93, "loose_threshold": 0.85}' | python3 -m json.tool
```

## 缓存

嵌入和哈希结果会自动缓存到 `~/.dedup-studio/cache/` 目录。

- 缓存文件命名: `{md5(folder)}_{imagename}.json`
- 同一文件夹第二次扫描时，已缓存的图片会跳过计算
- 可通过 `/api/clear_cache` 清除缓存

## 关键文件

| 文件 | 说明 |
|---|---|
| `app.py` | Flask 主应用，所有 API 端点 |
| `models.py` | 数据模型定义 (dataclass) |
| `cache.py` | 缓存读写管理 |
| `engine/clip_engine.py` | CLIP 嵌入计算 (ViT-B/32) |
| `engine/hash_engine.py` | pHash 感知哈希计算 |
| `engine/similarity.py` | 相似度计算 + 分组算法 |

## 关键函数签名

### cache.py

```python
def get_cache(folder: str, imagename: str) -> Optional[Any]
def set_cache(folder: str, imagename: str, data: Any) -> None
def clear_cache(folder: Optional[str] = None) -> int
```

### engine/clip_engine.py

```python
def compute_embeddings(images: List[str], folder: str) -> Dict[str, List[float]]
# device: MPS > CPU
# model: ViT-B/32 pretrained=openai
# returns: {imagename: [512-dim embedding]}
```

### engine/hash_engine.py

```python
def compute_hashes(images: List[str], folder: str) -> Dict[str, str]
# algorithm: pHash (64-bit)
# returns: {imagename: "hex_hash_string"}
```

### engine/similarity.py

```python
def cosine_similarity(a: List[float], b: List[float]) -> float
def hamming_distance(a: str, b: str) -> int
def find_groups_clip(embeddings, threshold, loose_threshold) -> List[Group]
def find_groups_hash(hashes, max_hamming=10) -> List[Group]
```

### Group 数据结构

```python
Group:
  id: int
  winner: str           # 保留的文件名
  winner_size: int       # winner 文件大小
  members: List[GroupMember]

GroupMember:
  name: str
  similarity: float     # 与 winner 的相似度
  to_remove: bool       # 是否标记为删除
```
