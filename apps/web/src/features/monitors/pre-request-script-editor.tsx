import { lazy, Suspense, useEffect, useRef, useState } from "react"
import type { OnMount } from "@monaco-editor/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@workspace/ui/components/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { AlignLeft, BookOpen, Braces, Check, CircleAlert, FileWarning, LoaderCircle, Map, Play, ScrollText, ShieldCheck, Sparkles, Variable } from "lucide-react"

import type { ScriptProblemContract, ScriptResultContract } from "@/lib/api-client/contracts"
import { previewPreRequestScript, validatePreRequestScript } from "@/lib/api-client/monitors"

const MonacoEditor = lazy(async () => ({ default: (await import("@monaco-editor/react")).default }))

export type ScriptDefinition = { enabled:boolean; language:"javascript"; code:string; runtimeVersion:"rhythm-js-1" }
type ScriptRequest = { method:string; url:string; headers:Array<{key:string;value:string;sensitive?:boolean}>; query:Array<{key:string;value:string;sensitive?:boolean}>; body:Record<string,unknown>; auth:Record<string,unknown> }

type Props = { value:ScriptDefinition; onChange:(value:ScriptDefinition)=>void; monitorId?:string; revisionId?:string; stepId?:string; request?:ScriptRequest }

/** Postman-style: non-empty script is enabled; empty is skipped. */
export function normalizeScriptDefinition(value: ScriptDefinition): ScriptDefinition {
  const code = value?.code ?? ""
  return {
    enabled: code.trim().length > 0,
    language: "javascript",
    code,
    runtimeVersion: "rhythm-js-1",
  }
}

const starter = `// Postman-compatible pre-request script (pm.*)
// Runs before the request is rendered and sent.
const traceId = crypto.randomUUID();
pm.variables.set("traceId", traceId);
pm.environment.set("preparedAt", String(Date.now()));

if (pm.request) {
  pm.request.headers.upsert({ key: "X-Trace-ID", value: traceId });
}

console.log("Prepared request", pm.variables.replaceIn("trace={{traceId}} / {{$guid}}"));
`

const snippets = [
  {label:"Insert snippet…",value:""},
  {label:"Set variable",value:'pm.variables.set("name", "value");'},
  {label:"Set environment",value:'pm.environment.set("name", "value");'},
  {label:"Replace templates",value:'const url = pm.variables.replaceIn("https://api.example.com/{{id}}?nonce={{$guid}}");'},
  {label:"Read secret",value:'const token = await pm.vault.get("api-token");'},
  {label:"Upsert header",value:'pm.request.headers.upsert({ key: "X-Header", value: "value" });'},
  {label:"Remove header",value:'pm.request.headers.remove("X-Header");'},
  {label:"Add query parameter",value:'pm.request.query.upsert({ key: "key", value: "value" });'},
  {label:"Set cookie",value:'pm.cookies.set("session", "value");'},
  {label:"Generate UUID",value:'const requestId = crypto.randomUUID();'},
  {label:"SHA-256 digest",value:'const bytes = new TextEncoder().encode("value");\nconst digest = await crypto.subtle.digest("SHA-256", bytes);'},
  {label:"HMAC SHA-256",value:'const encoder = new TextEncoder();\nconst key = await crypto.subtle.importKey(\n  "raw",\n  encoder.encode(await pm.vault.get("hmac-secret")),\n  { name: "HMAC", hash: "SHA-256" },\n  false,\n  ["sign"],\n);\nconst bytes = new Uint8Array(await crypto.subtle.sign(\n  { name: "HMAC", hash: "SHA-256" },\n  key,\n  encoder.encode(pm.request?.body?.content ?? ""),\n));\nconst signature = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");\npm.request?.headers.upsert({ key: "X-Signature", value: signature, sensitive: true });'},
  {label:"Send auxiliary request",value:'const response = await pm.sendRequest({\n  method: "GET",\n  url: "https://example.com/token",\n  headers: { Accept: "application/json" },\n});\nconst data = response.json();'},
  {label:"Assertion",value:'pm.test("value exists", () => {\n  pm.expect(pm.variables.get("value")).to.not.equal(undefined);\n});'},
]

export function PreRequestScriptEditor({value,onChange,monitorId,revisionId,stepId,request}:Props){
  const [mounted,setMounted]=useState(false);const [desktop,setDesktop]=useState(true);const [running,setRunning]=useState(false);const [minimap,setMinimap]=useState(false);const [result,setResult]=useState<ScriptResultContract|null>(null);const [problems,setProblems]=useState<ScriptProblemContract[]>([]);const [message,setMessage]=useState("");const editorRef=useRef<Parameters<OnMount>[0]|null>(null);const monacoRef=useRef<Parameters<OnMount>[1]|null>(null)
  useEffect(()=>{setMounted(true);const media=window.matchMedia("(min-width: 768px)");const update=()=>setDesktop(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update)},[])
  function change(code:string){
    onChange(normalizeScriptDefinition({...value,code}))
    setResult(null);setProblems([]);setMessage("")
  }
  const mount:OnMount=(editor,monaco)=>{editorRef.current=editor;monacoRef.current=monaco;monaco.languages.typescript.javascriptDefaults.addExtraLib(pmTypes,"file:///rhythm-pm.d.ts");editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter,()=>void preview())}
  function applyMarkers(items:ScriptProblemContract[]){const editor=editorRef.current,monaco=monacoRef.current;if(!editor||!monaco)return;const model=editor.getModel();if(!model)return;monaco.editor.setModelMarkers(model,"rhythm-script",items.map(item=>({severity:item.severity==="error"?monaco.MarkerSeverity.Error:monaco.MarkerSeverity.Warning,message:item.message,startLineNumber:item.line,startColumn:item.column,endLineNumber:item.line,endColumn:item.column+1,code:item.code})))}
  async function validate(){setMessage("");try{const response=await validatePreRequestScript({data:{code:value.code}});setProblems(response.problems);applyMarkers(response.problems);setMessage(response.valid?"Script is valid.":`${response.problems.length} problem${response.problems.length===1?"":"s"} found.`)}catch(error){setMessage(error instanceof Error?error.message:"Validation failed.")}}
  async function preview(){if(!monitorId||!revisionId){setMessage("Save the draft before running preview.");return}setRunning(true);setMessage("");try{const response=await previewPreRequestScript({data:{monitorId,revisionId,scope:"request",stepId,code:value.code,variables:{},request:request??null}});setResult(response);setProblems(response.problems);applyMarkers(response.problems);setMessage(response.status==="SUCCESS"?`Preview completed in ${response.durationMs} ms.`:response.errorMessage??"Preview failed.")}catch(error){setMessage(error instanceof Error?error.message:"Preview failed.")}finally{setRunning(false)}}
  function insert(valueToInsert:string){if(!valueToInsert)return;if(editorRef.current){const selection=editorRef.current.getSelection();if(selection)editorRef.current.executeEdits("snippet",[{range:selection,text:valueToInsert,forceMoveMarkers:true}]);editorRef.current.focus();const next=editorRef.current.getValue();change(next)}else change(`${value.code}${value.code?"\n":""}${valueToInsert}`)}
  async function format(){await editorRef.current?.getAction("editor.action.formatDocument")?.run()}
  return <div className="overflow-hidden rounded-xl border bg-background">
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/25 px-3 py-2"><div className="mr-auto"><p className="text-sm font-medium">Pre-request script</p><p className="text-xs text-muted-foreground">Postman-compatible pm.* — runs before the request when the script has content.</p></div><Badge variant="outline">rhythm-js-1</Badge>{!value.code?<Button type="button" size="sm" variant="ghost" onClick={()=>change(starter)}><Braces data-icon="inline-start"/> Add starter</Button>:null}<NativeSelect className="w-44" aria-label="Insert script snippet" value="" onChange={(event)=>insert(event.target.value)}>{snippets.map(item=><NativeSelectOption key={item.label} value={item.value}>{item.label}</NativeSelectOption>)}</NativeSelect>{desktop?<><Button type="button" size="sm" variant="ghost" onClick={()=>void format()}><AlignLeft data-icon="inline-start"/> Format</Button><Button type="button" size="icon-sm" variant={minimap?"secondary":"ghost"} onClick={()=>setMinimap(current=>!current)} aria-label="Toggle code minimap" aria-pressed={minimap}><Map/></Button></>:null}<ScriptDocs/><Button type="button" size="sm" variant="ghost" onClick={()=>void validate()}><FileWarning data-icon="inline-start"/> Validate</Button><Button type="button" size="sm" onClick={()=>void preview()} disabled={running||!value.code.trim()} title={!monitorId?"Save the draft to enable preview":undefined}>{running?<LoaderCircle className="animate-spin" data-icon="inline-start"/>:<Play data-icon="inline-start"/>} Run preview</Button></div>
    <div className="relative min-h-[360px] bg-[#1e1e1e]">{mounted&&desktop?<Suspense fallback={<EditorLoading/>}><MonacoEditor height="420px" language="javascript" theme="vs-dark" value={value.code} onChange={(code)=>change(code??"")} onMount={mount} options={{fontSize:13,lineHeight:21,fontLigatures:true,minimap:{enabled:minimap},automaticLayout:true,scrollBeyondLastLine:false,wordWrap:"on",padding:{top:14,bottom:14},tabSize:2,formatOnPaste:true,quickSuggestions:true,accessibilitySupport:"auto"}}/></Suspense>:<div className="p-3"><p className="mb-2 text-xs text-white/70">Compact editor · use a desktop browser for autocomplete and advanced navigation.</p><Textarea className="min-h-[330px] resize-y border-white/15 bg-[#1e1e1e] font-mono text-[13px] leading-5 text-white" spellCheck={false} value={value.code} onChange={(event)=>change(event.target.value)} aria-label="JavaScript pre-request code"/></div>}</div>
    <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground"><span>{value.code.length.toLocaleString()} / 65,536 characters</span><span>Ctrl/Cmd+Enter to preview</span><span className="ml-auto flex items-center gap-1"><ShieldCheck className="size-3.5"/> Real secrets stay masked in preview</span></div>
    <EvidencePanel result={result} problems={problems} message={message}/>
  </div>
}

function ScriptDocs(){return <Sheet><SheetTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label="Open JavaScript runtime reference"/>}><BookOpen/></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Rhythm JavaScript runtime</SheetTitle><SheetDescription>Postman-familiar APIs supported by the deterministic rhythm-js-1 sandbox.</SheetDescription></SheetHeader><div className="space-y-5 overflow-y-auto px-6 pb-6 text-sm"><Doc title="Variables" code="pm.variables · pm.environment · pm.collectionVariables · pm.globals" text="Use has, get, set, unset, replaceIn, and toObject. replaceIn also resolves {{$guid}}, {{$timestamp}}, {{$isoTimestamp}}, and {{$randomInt}}. Changes exist only for this run."/><Doc title="Request and cookies" code="pm.request · pm.cookies · pm.cookies.jar()" text="Mutate method, URL, headers, query, body, auth, and run-local cookies before rendering."/><Doc title="Secrets" code={'await pm.vault.get("alias")'} text="Secrets are read-only. Preview returns MASKED placeholders; real executions resolve vault values and mask them in evidence."/><Doc title="Checks and logging" code="pm.test · pm.expect · console.*" text="A failed pre-request check stops the main request. Console arguments are masked and size-limited."/><Doc title="Auxiliary HTTP" code="await pm.sendRequest(config)" text="Up to five calls per script, including during Run preview. Accepts header or headers. Calls use the same network path and policies as real runs (target, proxy, TLS, timeout, and cancellation)."/><Doc title="Web APIs" code="crypto · URL · URLSearchParams · TextEncoder · TextDecoder" text="SHA-256/384/512 digest and HMAC operations, secure random values, UUIDs, base64, timers, JSON, Date, Math, and Promise are available."/><p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">Unavailable by policy: fetch, XMLHttpRequest, eval, Function, require, Node globals, package imports, writable vault access, persistent globals, and unrestricted networking. Certificate and proxy configuration are not scriptable — use the TLS and Proxy tabs.</p></div></SheetContent></Sheet>}
function Doc({title,code,text}:{title:string;code:string;text:string}){return <section><h3 className="font-medium">{title}</h3><code className="mt-1 block break-words rounded bg-muted px-2 py-1.5 text-xs">{code}</code><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{text}</p></section>}

function EvidencePanel({result,problems,message}:{result:ScriptResultContract|null;problems:ScriptProblemContract[];message:string}){return <div className="min-h-40 resize-y overflow-auto border-t"><Tabs defaultValue="console" className="gap-0"><div className="border-b px-3"><TabsList variant="line"><TabsTrigger value="console"><ScrollText/> Console {result?.logs.length?`(${result.logs.length})`:""}</TabsTrigger><TabsTrigger value="variables"><Variable/> Variables</TabsTrigger><TabsTrigger value="changes"><Sparkles/> Request changes</TabsTrigger><TabsTrigger value="tests"><Check/> Tests</TabsTrigger><TabsTrigger value="problems"><CircleAlert/> Problems {problems.length?`(${problems.length})`:""}</TabsTrigger></TabsList></div><div className="max-h-64 overflow-auto p-3 font-mono text-xs">
  <TabsContent value="console">{message?<p className="mb-2 font-sans text-xs text-muted-foreground">{message}</p>:null}{result?.logs.length?result.logs.map((log,index)=><div className="grid grid-cols-[56px_1fr] gap-2 border-b py-1.5 last:border-0" key={`${log.timestamp}-${index}`}><span className={log.level==="error"?"text-destructive":log.level==="warn"?"text-warning-foreground":"text-muted-foreground"}>{log.level}</span><span className="break-words">{log.message}</span></div>):<Empty text="Console output appears here after preview."/>}</TabsContent>
  <TabsContent value="variables"><Changes items={result?.variableChanges??[]} empty="No variable changes recorded."/></TabsContent>
  <TabsContent value="changes"><Changes items={result?.requestChanges??[]} empty="No request changes recorded."/></TabsContent>
  <TabsContent value="tests">{result?.tests.length?result.tests.map((test,index)=><div className="flex gap-2 border-b py-2 last:border-0" key={`${test.name}-${index}`}>{test.skipped?<span>○</span>:test.passed?<span className="text-success">✓</span>:<span className="text-destructive">×</span>}<div><p>{test.name}</p>{test.error?<p className="mt-0.5 text-destructive">{test.error}</p>:null}</div></div>):<Empty text="No script tests recorded."/>}</TabsContent>
  <TabsContent value="problems">{problems.length?problems.map((problem,index)=><div className="grid grid-cols-[70px_1fr] gap-2 border-b py-2 last:border-0" key={`${problem.code}-${index}`}><span className="text-destructive">Ln {problem.line}:{problem.column}</span><div><p>{problem.message}</p><p className="mt-0.5 text-muted-foreground">{problem.code}</p></div></div>):<Empty text="No syntax or runtime problems."/>}</TabsContent>
  </div></Tabs></div>}
function Changes({items,empty}:{items:ScriptResultContract["variableChanges"];empty:string}){return items.length?items.map((item,index)=><div className="grid gap-1 border-b py-2 last:border-0 sm:grid-cols-[90px_150px_1fr]" key={`${item.scope}-${item.key}-${index}`}><Badge variant="outline" className="w-fit">{item.operation}</Badge><span>{item.scope}.{item.key}</span><span className="break-words text-muted-foreground">{item.state==="MASKED"?"MASKED":`${String(item.before??"∅")} → ${String(item.after??"∅")}`}</span></div>):<Empty text={empty}/>}function Empty({text}:{text:string}){return <p className="py-5 text-center font-sans text-xs text-muted-foreground">{text}</p>}function EditorLoading(){return <div className="grid h-[420px] place-items-center text-sm text-white/70"><LoaderCircle className="mr-2 inline size-4 animate-spin"/>Loading editor…</div>}

const pmTypes=`declare const pm: {
  variables: VariableScope; environment: VariableScope; collectionVariables: VariableScope; globals: VariableScope;
  cookies: { has(name:string):boolean; get(name:string):string|undefined; set(name:string,value:unknown):void; unset(name:string):void; clear():void; toObject():Record<string,string>; jar():CookieJar };
  vault: { get(alias:string):Promise<string>; set():Promise<never>; unset():Promise<never> };
  request: { method:string; url:string; headers:PropertyList; query:PropertyList; body:{type:string;content:string}; auth:Record<string,unknown> } | null;
  info: { eventName:"prerequest"; monitorId:string; runId:string; revisionId:string; stepId:string; requestName:string; runtimeVersion:"rhythm-js-1" };
  test(name:string,callback:()=>void):typeof pm; expect(value:unknown):any;
  sendRequest(config:string|Record<string,unknown>, callback?:(error:Error|null,response:ScriptResponse)=>void):Promise<ScriptResponse>|void;
};
interface VariableScope { has(key:string):boolean; get(key:string):string|undefined; set(key:string,value:unknown):void; unset(key:string):void; replaceIn(value:string):string; toObject():Record<string,string> }
interface PropertyList { add(item:{key:string;value:string;sensitive?:boolean}):void; upsert(item:{key:string;value:string;sensitive?:boolean}):void; remove(key:string):void; get(key:string):string|undefined; has(key:string):boolean; toObject():Record<string,string> }
interface CookieJar { get(url:string,name:string,callback?:(error:Error|null,value?:string)=>void):Promise<string|undefined>|void; getAll(url:string,callback?:(error:Error|null,value?:Record<string,string>)=>void):Promise<Record<string,string>>|void; set(url:string,cookie:{name:string;value:string},callback?:(error:Error|null)=>void):Promise<unknown>|void; unset(url:string,name:string,callback?:(error:Error|null)=>void):Promise<void>|void; clear(url:string,callback?:(error:Error|null)=>void):Promise<void>|void }
interface ScriptResponse { code:number; status:string; headers:Record<string,string>; text():string; json():unknown }
`
