/**
 * Generate the English demo catalog (data/products.json) — ~120 products across
 * diverse categories/brands/price ranges so faceting, filtering and semantic
 * search all have something to chew on.
 *
 * Run: npx tsx scripts/make-sample.ts
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Product } from "../src/types.js";

// [title, brand, price, tags, description]
type Row = [string, string, number, string, string];
const CATALOG: Record<string, Row[]> = {
  "Graphics Cards": [
    ["NVIDIA GeForce RTX 5090 32GB GDDR7", "NVIDIA", 1999, "gpu,rtx,4k", "Flagship graphics card with extreme frame rates, ray tracing and 4K rendering."],
    ["NVIDIA GeForce RTX 5080 16GB GDDR7", "NVIDIA", 1199, "gpu,rtx", "High-end GPU for smooth high-refresh-rate play and demanding 3D workloads."],
    ["NVIDIA GeForce RTX 5070 12GB", "NVIDIA", 649, "gpu,rtx", "Mainstream graphics card with great performance per dollar for fast titles."],
    ["AMD Radeon RX 8900 XTX 24GB", "AMD", 999, "gpu,radeon", "Powerful graphics card delivering high frames per second at 4K resolution."],
    ["AMD Radeon RX 8700 XT 16GB", "AMD", 549, "gpu,radeon", "Sharp value GPU for high frame rates at 1440p."],
    ["NVIDIA GeForce RTX 4070 Ti SUPER 16GB", "NVIDIA", 799, "gpu,rtx", "Excellent performance per watt for fast-paced, competitive play."],
  ],
  "Processors": [
    ["AMD Ryzen 9 9950X 16-Core Processor", "AMD", 649, "cpu,ryzen", "High-core-count desktop CPU for heavy multitasking and high frame rates."],
    ["AMD Ryzen 7 9700X 8-Core Processor", "AMD", 359, "cpu,ryzen", "Efficient 8-core chip for fast gaming and everyday performance."],
    ["AMD Ryzen 5 9600 6-Core Processor", "AMD", 229, "cpu,ryzen", "Affordable 6-core processor for mainstream builds."],
    ["Intel Core i9-14900K Desktop Processor", "Intel", 589, "cpu,core", "Top-tier 24-core CPU for performance desktops and content creation."],
    ["Intel Core i7-14700K Desktop Processor", "Intel", 409, "cpu,core", "High-performance 20-core CPU for gaming and creators."],
    ["Intel Core i5-14600K Desktop Processor", "Intel", 309, "cpu,core", "Great mid-range CPU balancing price and speed."],
  ],
  "Laptops": [
    ["Apple MacBook Air 15-inch M4", "Apple", 1299, "laptop,ultrabook", "Thin and light laptop with all-day battery for everyday productivity and travel."],
    ["Apple MacBook Pro 16-inch M4 Pro", "Apple", 2499, "laptop,creator", "Powerful laptop for video editing, code and creative pro workloads."],
    ["Dell XPS 14 OLED, 32GB RAM", "Dell", 1699, "laptop,ultrabook", "Premium ultrabook with a vivid OLED display for work and media."],
    ["Lenovo ThinkPad X1 Carbon", "Lenovo", 1549, "laptop,business", "Durable business laptop with a great keyboard for the office."],
    ["ASUS ROG Strix 18, RTX 5080, 240Hz", "ASUS", 2799, "laptop,rtx", "Desktop-replacement laptop with a fast GPU and high-refresh screen for demanding play."],
    ["HP Spectre x360 14", "HP", 1399, "laptop,convertible", "Convertible 2-in-1 laptop for work and sketching."],
    ["Acer Swift Go 14", "Acer", 849, "laptop,budget", "Lightweight everyday laptop on a budget."],
  ],
  "Monitors": [
    ["LG UltraGear 27\" 240Hz 1ms", "LG", 449, "monitor,240hz,esports", "Fast high-refresh display with instant response for competitive play."],
    ["Samsung Odyssey 49\" Ultrawide 240Hz", "Samsung", 1099, "monitor,ultrawide", "Immersive ultrawide display with a very high refresh rate."],
    ["Dell UltraSharp 27\" 4K IPS", "Dell", 549, "monitor,4k,creative", "Factory-calibrated 4K display for photo and video editing."],
    ["ASUS ProArt 32\" 4K", "ASUS", 899, "monitor,4k,creative", "Color-accurate large screen for creative professionals."],
    ["LG 27\" 4K Editing Monitor", "LG", 499, "monitor,4k,creative", "Crisp 4K panel for color-accurate editing work."],
    ["Samsung 32\" 1440p 165Hz", "Samsung", 329, "monitor,1440p", "Smooth high-refresh monitor for work and play."],
  ],
  "Keyboards": [
    ["Keychron Q1 Mechanical Keyboard", "Keychron", 169, "keyboard,mechanical", "Premium hot-swappable mechanical keyboard for typing and play."],
    ["Corsair K70 RGB Mechanical Keyboard", "Corsair", 159, "keyboard,mechanical,rgb", "Low-latency mechanical keyboard with per-key lighting, built for fast reactions."],
    ["Razer BlackWidow V4 Mechanical", "Razer", 139, "keyboard,mechanical,rgb", "Tactile mechanical keyboard for competitive players."],
    ["Logitech MX Keys S Wireless", "Logitech", 109, "keyboard,office,wireless", "Comfortable wireless keyboard for all-day work."],
    ["Logitech Ergo K860 Ergonomic", "Logitech", 119, "keyboard,office,ergonomic", "Split ergonomic keyboard that reduces wrist strain at the desk."],
    ["Keychron K3 Low-Profile Wireless", "Keychron", 89, "keyboard,wireless", "Slim wireless mechanical keyboard for portability."],
  ],
  "Mice": [
    ["Logitech G Pro X Superlight 2", "Logitech", 159, "mouse,wireless,esports", "Ultra-light wireless mouse with a high-precision sensor for competitive play."],
    ["Razer DeathAdder V3 Pro", "Razer", 149, "mouse,wireless,esports", "Lightweight ergonomic wireless mouse for fast reactions."],
    ["Logitech MX Master 3S", "Logitech", 99, "mouse,office", "Comfortable productivity mouse for all-day spreadsheets and documents."],
    ["Microsoft Ergonomic Mouse", "Microsoft", 39, "mouse,office,ergonomic", "Sculpted mouse for comfortable office work."],
    ["Razer Basilisk V3", "Razer", 69, "mouse,rgb", "Customizable mouse with extra buttons for play and work."],
  ],
  "Audio": [
    ["Bose QuietComfort Ultra Headphones", "Bose", 429, "headphones,anc,travel", "Over-ear headphones with class-leading active noise cancellation for travel."],
    ["Sony WH-1000XM6 Headphones", "Sony", 399, "headphones,anc", "Premium noise-cancelling headphones with long battery life."],
    ["Apple AirPods Pro 3", "Apple", 249, "earbuds,anc,wireless", "Compact wireless earbuds with adaptive noise cancellation."],
    ["Sony WF-1000XM5 Earbuds", "Sony", 299, "earbuds,anc", "True wireless earbuds with strong noise cancellation."],
    ["SteelSeries Arctis Nova Pro Headset", "SteelSeries", 249, "headset,surround,mic", "Over-ear headset with positional audio and a clear mic for play."],
    ["Sonos Era 100 Speaker", "Sonos", 249, "speaker,smart-home", "Compact smart speaker with room-filling sound."],
    ["JBL Charge 5 Portable Speaker", "JBL", 179, "speaker,bluetooth,portable", "Rugged waterproof Bluetooth speaker with deep bass for outdoors."],
    ["Sennheiser Studio Monitor Speakers", "Sennheiser", 349, "speaker,studio", "Active near-field monitors with flat, accurate sound for mixing."],
  ],
  "Storage": [
    ["Samsung 990 Pro NVMe SSD 2TB", "Samsung", 199, "ssd,nvme", "Blazing-fast solid state drive that cuts load times dramatically."],
    ["WD Black SN850X NVMe SSD 1TB", "Western Digital", 109, "ssd,nvme", "High-speed NVMe drive for gaming rigs."],
    ["Crucial T700 Gen5 SSD 2TB", "Crucial", 259, "ssd,nvme,gen5", "Top-tier Gen5 SSD for the fastest transfers."],
    ["Samsung T9 Portable SSD 1TB", "Samsung", 119, "ssd,portable,usb-c", "Pocket-sized external SSD for fast backups on the go."],
    ["SanDisk Extreme Portable SSD 2TB", "SanDisk", 169, "ssd,portable", "Rugged external drive for photographers and creators."],
    ["WD My Passport HDD 4TB", "Western Digital", 99, "hdd,backup", "High-capacity external hard drive for backups and archives."],
  ],
  "Phones": [
    ["Apple iPhone 17 Pro", "Apple", 1099, "phone,smartphone,camera", "Flagship phone with a pro-grade camera system and fast performance."],
    ["Samsung Galaxy S25 Ultra", "Samsung", 1199, "phone,smartphone,camera", "High-end phone with a 200MP camera and a built-in stylus."],
    ["Google Pixel 10 Pro", "Google", 999, "phone,smartphone,camera", "Smart phone with outstanding computational photography."],
    ["Apple iPhone 17", "Apple", 799, "phone,smartphone", "Everyday flagship with a great camera and long battery life."],
    ["Samsung Galaxy A56", "Samsung", 449, "phone,smartphone,budget", "Affordable phone with a big screen and solid battery."],
    ["Nothing Phone 3", "Nothing", 599, "phone,smartphone", "Distinctive mid-range phone with clean software."],
  ],
  "Tablets": [
    ["Apple iPad Pro 13\" M4", "Apple", 1299, "tablet,creative", "Powerful tablet with a stunning display for drawing and work."],
    ["Apple iPad Air 11\"", "Apple", 599, "tablet", "Versatile tablet for media, notes and light work."],
    ["Samsung Galaxy Tab S10", "Samsung", 799, "tablet", "Premium Android tablet with an included pen."],
  ],
  "Furniture": [
    ["Herman Miller Aeron Chair", "Herman Miller", 1395, "chair,office,ergonomic", "Iconic ergonomic office chair with breathable mesh for long workdays."],
    ["Secretlab Titan Evo Chair", "Secretlab", 549, "chair,gaming,ergonomic", "Reclining bucket-seat chair built for long sessions at the desk."],
    ["Steelcase Series 2 Office Chair", "Steelcase", 599, "chair,office,ergonomic", "Supportive mesh-back chair with adjustable lumbar support for the workday."],
    ["Flexispot E7 Standing Desk", "Flexispot", 459, "desk,standing,office", "Motorized sit-stand desk with memory presets for a healthier workspace."],
    ["IKEA Bekant Desk", "IKEA", 199, "desk,office", "Simple sturdy desk for a home office setup."],
    ["Branch Ergonomic Chair", "Branch", 339, "chair,office,ergonomic", "Comfortable adjustable office chair on a budget."],
  ],
  "Kitchen": [
    ["Breville Barista Express Espresso Machine", "Breville", 749, "coffee,espresso,kitchen", "Semi-automatic espresso machine with a built-in grinder for cafe-style coffee at home."],
    ["De'Longhi Dedica Espresso Machine", "De'Longhi", 249, "coffee,espresso,kitchen", "Slim espresso maker with a steam wand for lattes at home."],
    ["Baratza Encore Coffee Grinder", "Baratza", 169, "coffee,grinder,kitchen", "Consistent burr grinder for fresh coffee every morning."],
    ["Ninja Air Fryer 5.5L", "Ninja", 129, "air-fryer,kitchen", "Oil-free air fryer with presets for crispy meals in minutes."],
    ["Fellow Stagg Electric Kettle", "Fellow", 165, "kettle,kitchen", "Precise gooseneck kettle for pour-over coffee and tea."],
    ["Vitamix 5200 Blender", "Vitamix", 449, "blender,kitchen", "High-power blender for smoothies, soups and sauces."],
    ["Cuisinart Coffee Maker 12-Cup", "Cuisinart", 89, "coffee,kitchen", "Programmable drip coffee maker for the whole household."],
  ],
  "Networking": [
    ["TP-Link Deco BE63 Wi-Fi 7 Mesh (3-Pack)", "TP-Link", 399, "router,wifi7,mesh", "Whole-home mesh system with the latest Wi-Fi for low-latency connections."],
    ["Netgear Nighthawk RAXE500 Router", "Netgear", 299, "router,wifi6", "High-performance router for busy households."],
    ["Ubiquiti UniFi Express Gateway", "Ubiquiti", 149, "router,network", "Compact gateway for a clean, manageable home network."],
    ["TP-Link 8-Port Gigabit Switch", "TP-Link", 39, "switch,network", "Plug-and-play switch to add wired ports."],
    ["Netgear Wi-Fi 7 Range Extender", "Netgear", 119, "wifi,network", "Extends wireless coverage to dead spots."],
  ],
  "Cameras": [
    ["Logitech Brio 4K Webcam", "Logitech", 199, "webcam,4k,office", "Sharp webcam with autofocus and a wide field of view for meetings and streaming."],
    ["Sony Alpha a6700 Mirrorless Camera", "Sony", 1399, "camera,mirrorless", "Compact mirrorless camera for photo and video creators."],
    ["GoPro HERO 13 Black", "GoPro", 399, "camera,action", "Rugged waterproof action camera for adventures."],
    ["Canon EOS R8 Mirrorless Camera", "Canon", 1499, "camera,mirrorless", "Full-frame mirrorless camera for enthusiasts."],
    ["Elgato Facecam MK.2", "Elgato", 149, "webcam,streaming", "Crisp webcam tuned for streaming and video calls."],
  ],
  "Wearables": [
    ["Apple Watch Series 11", "Apple", 399, "smartwatch,fitness,gps", "Fitness smartwatch tracking workouts, sleep and heart rate with built-in GPS."],
    ["Garmin Forerunner 970", "Garmin", 649, "smartwatch,running,gps", "Advanced running watch with detailed training metrics."],
    ["Samsung Galaxy Watch 7", "Samsung", 329, "smartwatch,fitness", "Sleek smartwatch for health tracking and notifications."],
    ["Fitbit Charge 7", "Fitbit", 159, "fitness,band", "Slim fitness band for steps, sleep and heart rate."],
    ["Garmin Fenix 8", "Garmin", 999, "smartwatch,outdoor,gps", "Rugged multisport watch for the outdoors."],
  ],
  "Gaming": [
    ["Sony PlayStation 5 Pro", "Sony", 699, "console,gaming", "High-performance game console for 4K play."],
    ["Microsoft Xbox Series X", "Microsoft", 499, "console,gaming", "Powerful console with fast load times and 4K play."],
    ["Nintendo Switch 2", "Nintendo", 449, "console,gaming,portable", "Hybrid handheld and TV console for play anywhere."],
    ["Xbox Wireless Controller", "Microsoft", 59, "controller,gamepad,wireless", "Wireless gamepad with textured grips and low-latency connection."],
    ["Meta Quest 4 VR Headset", "Meta", 549, "vr,gaming", "Standalone VR headset for immersive games and experiences."],
  ],
  "Accessories": [
    ["Anker 737 Power Bank 24000mAh", "Anker", 99, "power-bank,charger", "High-capacity power bank that fast-charges laptops and phones."],
    ["Ugreen Nexode 100W GaN Charger", "Ugreen", 59, "charger,usb-c,gan", "Compact GaN charger that powers laptops and phones at full speed."],
    ["Anker 100W USB-C Charger", "Anker", 49, "charger,usb-c", "Small fast charger for everyday devices."],
    ["Belkin Thunderbolt 4 Dock", "Belkin", 299, "hub,dock,usb-c", "Docking station that adds ports and powers a laptop over one cable."],
    ["Ugreen 7-in-1 USB-C Hub", "Ugreen", 39, "hub,usb-c", "Portable hub adding HDMI, USB and card readers."],
  ],
  "Smart Home": [
    ["iRobot Roomba j9+ Robot Vacuum", "iRobot", 799, "vacuum,robot,smart-home", "Self-emptying robot vacuum that maps your home and avoids obstacles."],
    ["Amazon Echo Dot (5th Gen)", "Amazon", 49, "speaker,smart-home,assistant", "Compact smart speaker with a voice assistant for the home."],
    ["Google Nest Thermostat", "Google", 129, "thermostat,smart-home", "Smart thermostat that learns your schedule to save energy."],
    ["Ring Video Doorbell Pro 2", "Ring", 229, "camera,doorbell,smart-home", "Smart video doorbell with sharp video and motion alerts."],
    ["Philips Hue Starter Kit", "Philips", 179, "lighting,smart-home", "Smart lighting kit with millions of colors and app control."],
  ],
};

async function main(): Promise<void> {
  const products: Product[] = [];
  let id = 1;
  for (const [category, rows] of Object.entries(CATALOG)) {
    for (const [title, brand, price, tags, description] of rows) {
      products.push({
        id: id++,
        title,
        description,
        category,
        brand,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        price,
      });
    }
  }
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "products.json");
  await writeFile(out, JSON.stringify(products, null, 0), "utf8");
  const cats = new Set(products.map((p) => p.category)).size;
  const brands = new Set(products.map((p) => p.brand)).size;
  console.log(`Wrote ${products.length} products -> ${out}  (${cats} categories, ${brands} brands)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
