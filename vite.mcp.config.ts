import {defineConfig} from "vite";
import {viteSingleFile} from "vite-plugin-singlefile";
export default defineConfig({
 plugins:[viteSingleFile()],
 publicDir:false,
 build:{outDir:"mcp-dist",emptyOutDir:true,minify:"esbuild",cssCodeSplit:false,rollupOptions:{input:"mcp-ui/index.html"}},
});
