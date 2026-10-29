/**
 * Equivalencias español ↔ inglés para la búsqueda ampliada de Explorar Modelos (nivel 1, determinista).
 *
 * Son DATOS: para sumar una equivalencia basta agregar una entrada, sin tocar `query-variants.ts`.
 *
 * Qué NO es: un diccionario palabra por palabra. El motor entiende la estructura "objeto principal + complemento +
 * adjetivos" (soporte de notebook → laptop stand: el orden cambia y "soporte" se traduce según el complemento).
 * Por eso cada entrada es un concepto con sus formas en cada idioma, la preferida primero.
 *
 * Reglas para editar:
 * - Una misma forma (sin tildes ni mayúsculas) no puede pertenecer a dos conceptos del mismo idioma
 *   (lo verifica `tests/model-search-query-variants.test.mjs`).
 * - `es[0]` / `en[0]` es la forma preferida al GENERAR ese idioma; las demás sirven para reconocer sinónimos
 *   y regionalismos (notebook / laptop / portátil) y para variantes secundarias.
 * - En inglés las formas de un complemento van en singular ("phone", "headphone": `phone stand`); en español el
 *   complemento se lista como suele escribirse ("auriculares", "cables").
 * - Sustantivos en español en singular o plural conocido; adjetivos en masculino singular (el motor concuerda).
 * - `generic: true` marca palabras demasiado vagas para traducirlas solas (soporte, caja, funda).
 * - `withHead` da la traducción del OBJETO PRINCIPAL cuando este concepto es su complemento
 *   (pared + soporte → "mount", no "stand").
 */

export type LexiconPos = "noun" | "adj";

export interface LexiconEntry {
  id: string;
  pos: LexiconPos;
  es: string[];
  en: string[];
  /** Género del sustantivo en español; si falta se infiere de la terminación. */
  gender?: "m" | "f";
  /** Preposición española cuando es complemento ("soporte PARA celular", "organizador DE escritorio"). */
  prep?: "de" | "para";
  /** Demasiado ambiguo para traducirse sin complemento ni adjetivos. */
  generic?: boolean;
  /** Adjetivo que en español va ANTES del sustantivo ("mini robot"). */
  before?: boolean;
  /** Adjetivo de tamaño: en inglés va primero ("large hanging planter"). */
  size?: boolean;
  /** Formas del objeto principal cuando este concepto es su complemento, por id del objeto principal. */
  withHead?: Record<string, { es?: string[]; en?: string[] }>;
}

type NounOptions = Pick<LexiconEntry, "gender" | "prep" | "generic" | "withHead">;
type AdjectiveOptions = Pick<LexiconEntry, "before" | "size">;

const noun = (id: string, es: string[], en: string[], options: NounOptions = {}): LexiconEntry => ({ id, pos: "noun", es, en, ...options });
const adj = (id: string, es: string[], en: string[], options: AdjectiveOptions = {}): LexiconEntry => ({ id, pos: "adj", es, en, ...options });

const STAND_HOLDER = { support: { en: ["stand", "holder"] } };

export const LEXICON: readonly LexiconEntry[] = [
  // ── Objetos principales genéricos (su traducción depende del complemento) ──────────────────────────────────────
  noun("support", ["soporte"], ["stand", "holder", "mount", "bracket"], { generic: true }),
  noun("box", ["caja"], ["box"], { generic: true }),
  noun("case", ["funda", "estuche", "carcasa"], ["case", "cover"], { generic: true }),
  noun("part", ["pieza", "parte"], ["part", "piece"], { generic: true }),
  noun("accessory", ["accesorio"], ["accessory"], { generic: true }),

  // ── Objetos principales de uso cotidiano ───────────────────────────────────────────────────────────────────────
  noun("organizer", ["organizador"], ["organizer", "organiser"]),
  noun("keychain", ["llavero"], ["keychain", "keyring"]),
  noun("planter", ["maceta", "macetero"], ["planter", "plant pot", "flower pot"]),
  noun("vase", ["jarrón", "florero"], ["vase"]),
  noun("lamp", ["lámpara", "velador"], ["lamp"]),
  noun("shelf", ["estante", "repisa"], ["shelf"]),
  noun("drawer", ["cajón"], ["drawer"]),
  noun("tray", ["bandeja"], ["tray"]),
  noun("basket", ["canasto", "cesta", "canasta"], ["basket"]),
  noun("bowl", ["cuenco", "bol"], ["bowl"]),
  noun("plate", ["plato"], ["plate"]),
  noun("cup", ["taza", "vaso"], ["cup", "mug"]),
  noun("lid", ["tapa"], ["lid", "cap"]),
  noun("hook", ["gancho"], ["hook"]),
  noun("hanger", ["percha", "colgador"], ["hanger"]),
  noun("clamp", ["abrazadera", "pinza"], ["clamp"]),
  noun("clip", ["clip"], ["clip"]),
  noun("handle", ["manija", "manilla", "asa", "agarradera"], ["handle"]),
  noun("knob", ["perilla"], ["knob"]),
  noun("hinge", ["bisagra"], ["hinge"]),
  noun("gear", ["engranaje"], ["gear"]),
  noun("wheel", ["rueda"], ["wheel"]),
  noun("screw", ["tornillo"], ["screw"]),
  noun("nut", ["tuerca"], ["nut"]),
  noun("adapter", ["adaptador"], ["adapter", "adaptor"]),
  noun("connector", ["conector"], ["connector"]),
  noun("mold", ["molde"], ["mold", "mould"]),
  noun("stamp", ["sello"], ["stamp"]),
  noun("gift", ["regalo"], ["gift"]),
  noun("decoration", ["decoración", "adorno"], ["decoration", "ornament"]),
  noun("toy", ["juguete"], ["toy"]),
  noun("puzzle", ["rompecabezas", "puzzle"], ["puzzle"]),
  noun("tower", ["torre"], ["tower"], { gender: "f" }),
  noun("cube", ["cubo"], ["cube"]),
  noun("ring", ["anillo"], ["ring"]),
  noun("bracelet", ["pulsera"], ["bracelet"]),
  noun("earring", ["aros", "aretes", "pendientes", "zarcillos"], ["earring"]),

  // ── Figuras, criaturas y juegos ────────────────────────────────────────────────────────────────────────────────
  noun("dragon", ["dragón"], ["dragon"]),
  noun("dinosaur", ["dinosaurio"], ["dinosaur"]),
  noun("robot", ["robot"], ["robot"]),
  noun("skull", ["calavera", "cráneo"], ["skull"]),
  noun("cat", ["gato"], ["cat"]),
  noun("dog", ["perro"], ["dog"]),
  noun("horse", ["caballo"], ["horse"]),
  noun("bird", ["pájaro", "ave"], ["bird"]),
  noun("fish", ["pez", "peces"], ["fish"]),
  noun("flower", ["flor"], ["flower"], { gender: "f" }),
  noun("tree", ["árbol"], ["tree"]),
  noun("heart", ["corazón"], ["heart"]),
  noun("car", ["auto", "coche", "carro"], ["car"]),
  noun("truck", ["camión"], ["truck"]),
  noun("plane", ["avión"], ["airplane", "plane"]),
  noun("boat", ["barco"], ["boat", "ship"]),
  noun("house", ["casa"], ["house"]),
  noun("castle", ["castillo"], ["castle"]),
  noun("figure", ["figura", "figurita", "muñeco"], ["figure", "figurine"]),
  noun("miniature", ["miniatura"], ["miniature"]),
  noun("mask", ["máscara"], ["mask"]),
  noun("sword", ["espada"], ["sword"]),
  noun("shield", ["escudo"], ["shield"]),
  noun("helmet", ["casco"], ["helmet"]),
  noun("dice", ["dado"], ["dice", "die"]),
  noun("terrain", ["terreno"], ["terrain"]),
  noun("dungeon", ["mazmorra", "calabozo"], ["dungeon"]),
  noun("token", ["ficha"], ["token"]),
  noun("card", ["carta", "tarjeta"], ["card"]),
  noun("board", ["tablero"], ["board"]),
  noun("christmas", ["navidad"], ["christmas"]),

  // ── Impresión 3D ───────────────────────────────────────────────────────────────────────────────────────────────
  noun("replacement", ["repuesto", "recambio"], ["replacement part", "spare part"]),
  noun("filament", ["filamento"], ["filament"]),
  noun("spool", ["bobina", "carrete"], ["spool"], { prep: "de", withHead: { support: { en: ["holder", "stand"] } } }),
  noun("printer", ["impresora"], ["printer"], { prep: "para" }),
  noun("nozzle", ["boquilla"], ["nozzle"]),
  noun("extruder", ["extrusor"], ["extruder"]),
  noun("fan", ["ventilador"], ["fan"]),
  noun("duct", ["ducto", "conducto"], ["duct"]),
  noun("calibration", ["calibración"], ["calibration"]),
  noun("temperature", ["temperatura"], ["temperature"], { gender: "f" }),
  noun("retraction", ["retracción"], ["retraction"]),

  // ── Dispositivos y objetos que suelen ser el complemento ("soporte PARA …") ────────────────────────────────────
  noun("laptop", ["notebook", "laptop", "computadora portátil", "ordenador portátil", "compu portátil"], ["laptop", "notebook"], {
    prep: "para",
    withHead: STAND_HOLDER,
  }),
  noun("computer", ["computadora", "ordenador", "pc", "compu"], ["computer", "pc"], {
    prep: "de",
    withHead: { case: { es: ["gabinete"], en: ["case"] } },
  }),
  noun("phone", ["celular", "teléfono", "móvil", "smartphone", "teléfono celular", "teléfono móvil"], ["phone", "cellphone", "cell phone", "smartphone", "mobile phone"], {
    prep: "para",
    withHead: { ...STAND_HOLDER, box: { en: ["case"] } },
  }),
  noun("tablet", ["tablet", "tableta"], ["tablet"], { prep: "para", withHead: STAND_HOLDER }),
  noun("monitor", ["monitor", "pantalla"], ["monitor", "screen", "display"], { prep: "para", withHead: STAND_HOLDER }),
  noun("keyboard", ["teclado"], ["keyboard"], { prep: "para" }),
  noun("mouse", ["mouse", "ratón"], ["mouse"], { prep: "para" }),
  noun("controller", ["control", "joystick", "mando", "gamepad"], ["controller", "gamepad", "joystick"], { prep: "para", withHead: STAND_HOLDER }),
  noun("console", ["consola"], ["console"], { prep: "para", withHead: STAND_HOLDER }),
  noun("remote", ["control remoto", "mando a distancia"], ["remote control", "remote"], { prep: "para", withHead: { support: { en: ["holder", "stand"] } } }),
  noun("camera", ["cámara"], ["camera"], { prep: "para" }),
  noun("watch", ["reloj", "smartwatch"], ["watch", "smartwatch"], { prep: "para", withHead: STAND_HOLDER }),
  noun("speaker", ["parlante", "altavoz", "bocina"], ["speaker"], { prep: "para", withHead: STAND_HOLDER }),
  noun("microphone", ["micrófono", "mic"], ["microphone", "mic"], { prep: "para", withHead: STAND_HOLDER }),
  noun("headphones", ["auriculares", "audífonos"], ["headphone", "headset"], { prep: "para", withHead: STAND_HOLDER }),
  noun("glasses", ["anteojos", "lentes", "gafas"], ["glasses", "eyeglasses"], { prep: "para" }),
  noun("charger", ["cargador"], ["charger"], { prep: "para", withHead: { support: { en: ["stand", "holder", "dock"] } } }),
  noun("cable", ["cables", "cable"], ["cable"], { prep: "de" }),
  noun("key", ["llaves", "llave"], ["key"], { prep: "para" }),
  noun("pen", ["lapicera", "birome", "bolígrafo"], ["pen"], { prep: "para" }),
  noun("pencil", ["lápiz", "lápices"], ["pencil"], { prep: "para" }),
  noun("tool", ["herramientas", "herramienta"], ["tool"], { prep: "de" }),
  noun("knife", ["cuchillo"], ["knife"], { prep: "para", withHead: { support: { en: ["holder", "block"] } } }),
  noun("bottle", ["botella"], ["bottle"], { prep: "para" }),
  noun("book", ["libro"], ["book"], { prep: "para" }),
  noun("desk", ["escritorio"], ["desk"]),
  noun("table", ["mesa"], ["table"], { gender: "f" }),
  noun("wall", ["pared"], ["wall"], { gender: "f", withHead: { support: { en: ["mount", "bracket"] } } }),
  noun("ceiling", ["techo"], ["ceiling"], { withHead: { support: { en: ["mount", "bracket"] } } }),
  noun("door", ["puerta"], ["door"]),
  noun("window", ["ventana"], ["window"]),
  noun("kitchen", ["cocina"], ["kitchen"]),
  noun("bathroom", ["baño"], ["bathroom"]),
  noun("bike", ["bicicleta", "bici"], ["bike", "bicycle"], { prep: "para", gender: "f" }),
  noun("motorcycle", ["moto", "motocicleta"], ["motorcycle", "motorbike"], { prep: "para", gender: "f" }),
  noun("chair", ["silla"], ["chair"]),

  // ── Adjetivos (en español: masculino singular) ─────────────────────────────────────────────────────────────────
  adj("articulated", ["articulado"], ["articulated"]),
  adj("hanging", ["colgante"], ["hanging"]),
  adj("foldable", ["plegable"], ["foldable", "folding"]),
  adj("adjustable", ["ajustable"], ["adjustable"]),
  adj("stackable", ["apilable"], ["stackable"]),
  adj("magnetic", ["magnético"], ["magnetic"]),
  adj("rotating", ["giratorio"], ["rotating", "swivel"]),
  adj("modular", ["modular"], ["modular"]),
  adj("flexible", ["flexible"], ["flexible"]),
  adj("small", ["pequeño", "chico"], ["small"], { size: true }),
  adj("large", ["grande"], ["large", "big"], { size: true }),
  adj("giant", ["gigante"], ["giant"], { size: true }),
  adj("mini", ["mini"], ["mini"], { before: true, size: true }),
  adj("custom", ["personalizado"], ["custom", "personalized"]),
  adj("vertical", ["vertical"], ["vertical"]),
  adj("horizontal", ["horizontal"], ["horizontal"]),
  adj("portable", ["portátil"], ["portable"]),
  adj("decorative", ["decorativo"], ["decorative"]),
  adj("double", ["doble"], ["double"]),
  adj("universal", ["universal"], ["universal"]),
  adj("compact", ["compacto"], ["compact"], { size: true }),
];

/**
 * Expresiones fijas que no se arman por composición. Cada lado lista sinónimos, el preferido primero.
 * Se aplican solo cuando la consulta ES exactamente una de esas expresiones.
 */
export interface PhraseEntry {
  es: string[];
  en: string[];
}

export const PHRASES: readonly PhraseEntry[] = [
  { es: ["caja de herramientas", "caja herramientas"], en: ["toolbox", "tool box"] },
  { es: ["portalápices", "porta lápices", "lapicero"], en: ["pencil holder", "pen holder"] },
  { es: ["portallaves", "porta llaves"], en: ["key holder"] },
  { es: ["soporte para celular", "portacelular", "porta celular", "porta celulares"], en: ["phone stand", "phone holder"] },
  { es: ["posavasos", "porta vasos"], en: ["coaster"] },
  { es: ["cama caliente", "cama calefaccionada", "base calefaccionada"], en: ["heated bed", "heatbed"] },
  { es: ["anteojos de sol", "gafas de sol", "lentes de sol"], en: ["sunglasses"] },
  { es: ["cortador de galletas", "cortante de galletas"], en: ["cookie cutter"] },
  { es: ["perchero"], en: ["coat rack", "coat hanger"] },
];

/**
 * Nombres propios, marcas y franquicias: nunca se traducen y se conservan tal cual dentro de una consulta
 * ("soporte para ps5" → "ps5 stand"; "dragon ball goku" no se convierte en "bola de dragón goku").
 * Las formas se escriben sin tildes ni mayúsculas.
 */
export const PROTECTED_WORDS: readonly string[] = [
  "dragon ball", "star wars", "harry potter", "game of thrones", "lord of the rings", "attack on titan", "five nights at freddys",
  "hello kitty", "among us", "steam deck", "baby yoda", "raspberry pi",
  "pokemon", "pikachu", "mario", "luigi", "zelda", "minecraft", "batman", "superman", "spiderman", "marvel", "disney", "grogu",
  "mandalorian", "stitch", "totoro", "naruto", "goku", "sonic", "fortnite", "lego", "fnaf", "gridfinity", "benchy", "stl", "3mf",
  "ender", "prusa", "bambu", "creality", "voron", "anycubic", "elegoo", "arduino", "esp32", "ps4", "ps5", "xbox", "switch", "nintendo",
  "iphone", "ipad", "macbook", "samsung", "galaxy", "airpods", "ikea", "gopro", "kindle", "playstation", "tesla", "pixel",
  // Sufijos de modelo ("ender 3 pro", "bambu x1 carbon"): solo se aceptan como parte de un nombre propio.
  "pro", "max", "plus", "lite", "se", "ultra", "air", "carbon", "neo",
];
