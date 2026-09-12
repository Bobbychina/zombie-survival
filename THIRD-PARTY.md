# 第三方组件与素材

游戏本体（`src/`、`docs/`、构建产物）版权归 Bobbychina 所有，按根目录 `LICENSE`（PolyForm Noncommercial License 1.0.0）授权：**允许任何非商业用途，禁止商业使用**。

下面这些第三方代码被打进单文件构建产物里，各自保留原许可：

## seedrandom

- 用途：世界生成与战斗掷点的可复现随机数（`src/v4/worldgen.ts`）
- 许可：MIT
- 版权：Copyright 2019 David Bau

```
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## simplex-noise

- 用途：大世界生物群系噪声（高程 / 城区 / 工业 / 乡村四张图）
- 许可：MIT
- 版权：Copyright (c) 2018 Jonas Wagner

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 构建工具（不进产物，仅开发依赖）

Vite、TypeScript、Vitest、vite-plugin-singlefile——均为 MIT 许可，只在开发与构建时使用。

## 美术素材

游戏内没有任何外部图片/音频文件：所有图标是 Unicode emoji，音效与配乐是运行时用 WebAudio 现场合成的。因此不涉及第三方素材授权。
