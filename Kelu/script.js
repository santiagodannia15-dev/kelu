/* ===== Kelu · tienda: carrito + sesión + cupones + pagos =====
   IMPORTANTE: todo se guarda en localStorage (demo funcional sin servidor).
   Para cobrar de verdad con tarjeta necesitas un backend + proveedor
   (Mercado Pago, Stripe, Conekta). Ver procesarTarjeta() más abajo. */

// Carga extras.css por su cuenta (junto a script.js) si no está enlazado en el HTML
(() => {
    const src = document.currentScript && document.currentScript.src;
    if (!src || document.querySelector('link[href*="extras.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = src.replace(/script\.js.*$/, "extras.css");
    document.head.appendChild(l);
})();

const $ = id => document.getElementById(id);
const dinero = n => "$" + n.toLocaleString("es-MX") + " MXN";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (e) { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

/* ---------- Configuración ---------- */
const WHATSAPP = "528991240803";            // 52 + tu número de 10 dígitos
const ENVIO_GRATIS_DESDE = 799;
const COSTO_ENVIO = 79;
const CLABE = "137822104889608010";         // <- pon tu CLABE real
const BANCO = "Bancoppel · A nombre de: Kelu";
const CUPONES = {
    KELU10: { txt: "10% en tu primera compra", tipo: "pct", valor: 10, primera: true },
    REGALO50: { txt: "$50 de descuento en compras desde $500", tipo: "monto", valor: 50, min: 500 },
    ENVIOGRATIS: { txt: "Envío gratis", tipo: "envio" }
};

/* ---------- Estado ---------- */
let carrito = leer("kelu-carrito", []);
let cupon = leer("kelu-cupon", null);
let usuarios = leer("kelu-usuarios", {});
let sesion = leer("kelu-sesion", null);       // email
let pedidos = leer("kelu-pedidos", []);
const usuario = () => (sesion && usuarios[sesion]) || null;
if (sesion && !usuario()) sesion = null;

/* ---------- Estructura inyectada ---------- */
document.body.insertAdjacentHTML("beforeend",
    '<div class="modal-fondo" id="modalFondo" hidden><div class="modal" id="modal" role="dialog" aria-modal="true"></div></div><div class="toast" id="toast" role="status"></div>');
$("modalFondo").addEventListener("click", e => { if (e.target.id === "modalFondo") cerrarModal(); });

/* Estilos mínimos del modal: garantizan que flote sobre la página, sin depender de extras.css */
document.head.insertAdjacentHTML("beforeend", `<style id="kelu-modal-base">
    .modal-fondo { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center;
        padding: 16px; background: rgba(0,0,0,.55); overflow-y: auto; }
    .modal-fondo[hidden] { display: none; }
    .modal { position: relative; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto;
        background: #fff; color: #222; border-radius: 16px; padding: 28px 24px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    .modal-x { position: absolute; top: 10px; right: 12px; background: none; border: 0; font-size: 20px; cursor: pointer; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 10000; }
</style>`);

$(("pagar")).closest(".carrito-pie").innerHTML = `
    <form class="cupon-form" id="cuponForm">
        <input id="cuponInput" placeholder="Código de cupón" autocomplete="off" aria-label="Código de cupón">
        <button class="btn btn-sm btn-borde" type="submit">Aplicar</button>
    </form>
    <p class="cupon-msg" id="cuponMsg"></p>
    <div id="resumen"></div>
    <button class="btn" id="pagar">Finalizar compra</button>`;

const navAcc = document.querySelector(".nav-acciones");
navAcc.insertAdjacentHTML("afterbegin", '<button class="btn-carrito" id="btnCuenta"></button>');

function toast(t) {
    const el = $("toast");
    el.textContent = t;
    el.classList.add("ver");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("ver"), 3200);
}
function abrirModal(html) {
    $("modal").innerHTML = '<button class="modal-x" id="modalX" aria-label="Cerrar">✕</button>' + html;
    $("modalX").onclick = cerrarModal;
    $("modalFondo").hidden = false;
    $("modalFondo").classList.add("ver");
    document.body.style.overflow = "hidden";
    abrir(false);
}
function cerrarModal() {
    $("modalFondo").hidden = true;
    $("modalFondo").classList.remove("ver");
    document.body.style.overflow = "";
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { cerrarModal(); abrir(false); } });

/* ---------- Carrito ---------- */
const panel = $("carrito"), overlay = $("overlay");
function abrir(v) {
    panel.classList.toggle("abierto", v);
    overlay.classList.toggle("abierto", v);
    panel.setAttribute("aria-hidden", String(!v));
}

function validarCupon(code, sub) {
    const c = CUPONES[code];
    if (!c) return "Ese cupón no existe";
    if (c.min && sub < c.min) return `Requiere una compra mínima de ${dinero(c.min)}`;
    if (c.primera) {
        if (!sesion) return "Inicia sesión para usar este cupón";
        if (pedidos.some(p => p.email === sesion)) return "Este cupón es solo para tu primera compra";
    }
    return "";
}

function calcular() {
    const sub = carrito.reduce((s, p) => s + p.precio * p.cantidad, 0);
    let desc = 0, envio = sub === 0 || sub >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO, error = "";
    if (cupon) {
        error = validarCupon(cupon, sub);
        const c = CUPONES[cupon];
        if (!error) {
            if (c.tipo === "pct") desc = Math.round(sub * c.valor / 100);
            if (c.tipo === "monto") desc = Math.min(c.valor, sub);
            if (c.tipo === "envio") envio = 0;
        }
    }
    return { sub, desc, envio, total: sub - desc + envio, error };
}

function render() {
    const lista = $("lista");
    lista.innerHTML = carrito.length ? "" : '<li class="vacio">Tu carrito está vacío</li>';
    carrito.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `
            <div><strong>${esc(p.nombre)}</strong><span>${dinero(p.precio)}</span></div>
            <div class="cant">
                <button data-accion="menos" data-id="${esc(p.id)}" aria-label="Quitar uno">−</button>
                <span>${p.cantidad}</span>
                <button data-accion="mas" data-id="${esc(p.id)}" aria-label="Agregar uno">+</button>
            </div>
            <button class="quitar" data-accion="quitar" data-id="${esc(p.id)}" aria-label="Eliminar">🗑</button>`;
        lista.appendChild(li);
    });

    const t = calcular();
    $("resumen").innerHTML = `
        <p class="r"><span>Subtotal</span><span>${dinero(t.sub)}</span></p>
        ${t.desc ? `<p class="r desc"><span>Cupón ${esc(cupon)}</span><span>−${dinero(t.desc)}</span></p>` : ""}
        <p class="r"><span>Envío</span><span>${t.envio ? dinero(t.envio) : "Gratis"}</span></p>
        <p class="r total"><span>Total</span><strong id="total">${dinero(t.total)}</strong></p>`;
    const msg = $("cuponMsg");
    msg.className = "cupon-msg" + (t.error ? " err" : cupon ? " ok" : "");
    msg.innerHTML = t.error ? esc(t.error) : cupon ? `✓ ${esc(CUPONES[cupon].txt)} <button type="button" class="link" id="quitarCupon">Quitar</button>` : "";
    $("contador").textContent = carrito.reduce((s, p) => s + p.cantidad, 0);
    $("btnCuenta").textContent = usuario() ? "👤 " + usuario().nombre.split(" ")[0] : "Iniciar sesión";
    guardar("kelu-carrito", carrito);
    guardar("kelu-cupon", cupon);
}

document.querySelectorAll(".agregar").forEach(btn => {
    btn.addEventListener("click", () => {
        const { nombre, precio } = btn.dataset;
        const id = slug(nombre);   // id único por producto (antes varios compartían id)
        const ex = carrito.find(p => p.id === id);
        if (ex) ex.cantidad++; else carrito.push({ id, nombre, precio: Number(precio), cantidad: 1 });
        render();
        abrir(true);
    });
});

$("lista").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const item = carrito.find(p => p.id === btn.dataset.id);
    if (!item) return;
    if (btn.dataset.accion === "mas") item.cantidad++;
    if (btn.dataset.accion === "menos") item.cantidad--;
    if (btn.dataset.accion === "quitar") item.cantidad = 0;
    carrito = carrito.filter(p => p.cantidad > 0);
    render();
});

$("abrirCarrito").addEventListener("click", () => abrir(true));
$("cerrarCarrito").addEventListener("click", () => abrir(false));
overlay.addEventListener("click", () => abrir(false));

/* ---------- Cupones ---------- */
function aplicarCupon(codigo) {
    const code = codigo.trim().toUpperCase();
    if (!code) return;
    const sub = calcular().sub;
    if (!CUPONES[code]) { cupon = null; render(); $("cuponMsg").className = "cupon-msg err"; $("cuponMsg").textContent = "Ese cupón no existe"; return; }
    cupon = code;
    render();
}
$("cuponForm").addEventListener("submit", e => {
    e.preventDefault();
    aplicarCupon($("cuponInput").value);
    $("cuponInput").value = "";
});
$("cuponMsg").addEventListener("click", e => {
    if (e.target.id === "quitarCupon") { cupon = null; render(); }
});

// Formulario "Recibe 10% en tu primera compra"
const formNews = document.querySelector(".contacto form");
formNews.insertAdjacentHTML("afterend", '<p class="cupon-msg ok news-msg" id="newsMsg"></p>');
formNews.addEventListener("submit", e => {
    e.preventDefault();
    const correo = $("correo").value.trim().toLowerCase();
    const subs = leer("kelu-suscriptores", []);
    if (!subs.includes(correo)) subs.push(correo);
    guardar("kelu-suscriptores", subs);
    cupon = "KELU10";
    render();
    $("newsMsg").textContent = "¡Listo! Tu cupón es KELU10 y ya está aplicado en tu carrito (válido en tu primera compra con sesión iniciada).";
    formNews.reset();
});

/* ---------- Sesión ---------- */
async function hashear(t) {
    try {
        const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
    } catch (e) { return btoa(unescape(encodeURIComponent(t))); }
}

function modalAuth(modo, despues) {
    const reg = modo === "registro";
    abrirModal(`
        <h2>${reg ? "Crea tu cuenta" : "Inicia sesión"}</h2>
        <form id="authForm" class="form">
            ${reg ? '<label>Nombre<input name="nombre" required autocomplete="name"></label>' : ""}
            <label>Correo<input name="email" type="email" required autocomplete="email"></label>
            <label>Contraseña<input name="pass" type="password" required minlength="6" autocomplete="${reg ? "new-password" : "current-password"}"></label>
            <p class="cupon-msg err" id="authErr"></p>
            <button class="btn" type="submit">${reg ? "Crear cuenta" : "Entrar"}</button>
        </form>
        <p class="modal-pie">${reg ? "¿Ya tienes cuenta?" : "¿Eres nueva?"}
            <button class="link" id="cambiarModo">${reg ? "Inicia sesión" : "Regístrate y recibe 10%"}</button></p>`);
    $("cambiarModo").onclick = () => modalAuth(reg ? "login" : "registro", despues);
    $("authForm").addEventListener("submit", async e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const email = f.get("email").trim().toLowerCase(), h = await hashear(f.get("pass"));
        if (reg) {
            if (usuarios[email]) return ($("authErr").textContent = "Ese correo ya tiene cuenta. Inicia sesión.");
            usuarios[email] = { nombre: f.get("nombre").trim(), hash: h };
            guardar("kelu-usuarios", usuarios);
            if (!cupon) cupon = "KELU10";
        } else if (!usuarios[email] || usuarios[email].hash !== h) {
            return ($("authErr").textContent = "Correo o contraseña incorrectos");
        }
        sesion = email;
        guardar("kelu-sesion", sesion);
        cerrarModal();
        render();
        toast(reg ? "¡Bienvenida! Tu cupón KELU10 está en el carrito" : "Sesión iniciada");
        if (despues) despues();
    });
}

function modalCuenta() {
    const mios = pedidos.filter(p => p.email === sesion).reverse();
    abrirModal(`
        <h2>Hola, ${esc(usuario().nombre)}</h2>
        <p class="sub2">${esc(sesion)}</p>
        <h3>Tus pedidos</h3>
        <ul class="pedidos">${mios.length ? mios.map(p => `
            <li><strong>${esc(p.id)}</strong> · ${new Date(p.fecha).toLocaleDateString("es-MX")}<br>
            ${dinero(p.total)} · ${esc(p.metodoTxt)} · <em>${esc(p.estado)}</em></li>`).join("") : "<li>Aún no tienes pedidos.</li>"}</ul>
        <button class="btn btn-borde" id="salir">Cerrar sesión</button>`);
    $("salir").onclick = () => { sesion = null; guardar("kelu-sesion", null); cerrarModal(); render(); toast("Sesión cerrada"); };
}
$("btnCuenta").addEventListener("click", () => usuario() ? modalCuenta() : modalAuth("login"));

/* ---------- Pago ---------- */
const METODOS = {
    tarjeta: "Tarjeta de crédito o débito",
    spei: "Transferencia SPEI",
    oxxo: "Pago en OXXO",
    whatsapp: "Pagar por WhatsApp / contra entrega"
};

const luhn = n => { let s = 0, d = false; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d && (x *= 2) > 9) x -= 9; s += x; d = !d; } return n.length >= 13 && s % 10 === 0; };

/* Aquí conectarías tu proveedor real. Nunca guardes ni envíes el número de tarjeta
   a tu propio servidor: usa el formulario/tokenización del proveedor (Mercado Pago, Stripe...). */
async function procesarTarjeta(datos, total) {
    await new Promise(r => setTimeout(r, 1400));   // simulación
    return { ok: true, ultimos4: datos.numero.slice(-4) };
}

function checkout() {
    if (!carrito.length) return;
    if (!usuario()) { modalAuth("login", checkout); return toast("Inicia sesión para finalizar tu compra"); }
    let t = calcular();
    if (t.error) {   // un cupón inválido ya no bloquea la compra: se quita y se avisa
        const motivo = t.error;
        cupon = null; render(); t = calcular();
        toast("Quitamos el cupón: " + motivo);
    }
    abrirModal(`
        <h2>Finalizar compra</h2>
        <form id="pagoForm" class="form" novalidate>
            <fieldset><legend>Datos de envío</legend>
                <label>Nombre completo<input name="nombre" required value="${esc(usuario().nombre)}"></label>
                <label>Teléfono<input name="tel" required inputmode="tel" pattern="[0-9 +()-]{10,}"></label>
                <label>Dirección<input name="dir" required></label>
                <label>Código postal<input name="cp" required inputmode="numeric" pattern="[0-9]{5}" maxlength="5"></label>
            </fieldset>
            <fieldset><legend>Método de pago</legend>
                ${Object.entries(METODOS).map(([k, v], i) => `<label class="radio"><input type="radio" name="metodo" value="${k}" ${i === 0 ? "checked" : ""}> ${v}</label>`).join("")}
                <div id="campoTarjeta">
                    <label>Número de tarjeta<input name="numero" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" maxlength="19"></label>
                    <label>Nombre del titular<input name="titular" autocomplete="cc-name"></label>
                    <div class="dos"><label>Vence<input name="vence" placeholder="MM/AA" maxlength="5" autocomplete="cc-exp"></label>
                    <label>CVV<input name="cvv" inputmode="numeric" maxlength="4" autocomplete="cc-csc" type="password"></label></div>
                </div>
            </fieldset>
            <p class="r total"><span>Total a pagar</span><strong>${dinero(t.total)}</strong></p>
            <p class="cupon-msg err" id="pagoErr"></p>
            <button class="btn" type="submit" id="btnPago">Pagar ${dinero(t.total)}</button>
        </form>`);
    const f = $("pagoForm");
    const mostrar = () => { $("campoTarjeta").style.display = f.metodo.value === "tarjeta" ? "block" : "none"; };
    f.addEventListener("change", mostrar); mostrar();
    f.numero.addEventListener("input", () => f.numero.value = f.numero.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim());
    f.vence.addEventListener("input", () => { let v = f.vence.value.replace(/\D/g, "").slice(0, 4); f.vence.value = v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v; });

    f.addEventListener("submit", async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(f));
        const err = m => {
            $("pagoErr").textContent = m;
            $("pagoErr").scrollIntoView({ block: "center", behavior: "smooth" });
            toast(m);
        };
        if (d.nombre.trim().length < 3 || !/^[0-9 +()-]{10,}$/.test(d.tel) || d.dir.trim().length < 5) return err("Revisa nombre, teléfono y dirección");
        if (!/^\d{5}$/.test(d.cp)) return err("El código postal debe tener 5 dígitos");
        let ultimos4 = "";
        if (d.metodo === "tarjeta") {
            const num = d.numero.replace(/\s/g, "");
            const [mm, aa] = d.vence.split("/").map(Number);
            const hoy = new Date();
            if (!luhn(num)) return err("El número de tarjeta no es válido");
            if (!d.titular.trim()) return err("Escribe el nombre del titular");
            if (!(mm >= 1 && mm <= 12) || !aa || new Date(2000 + aa, mm) < hoy) return err("La tarjeta está vencida o la fecha es incorrecta");
            if (!/^\d{3,4}$/.test(d.cvv)) return err("El CVV debe tener 3 o 4 dígitos");
            $("btnPago").disabled = true; $("btnPago").textContent = "Procesando…";
            try {
                const r = await procesarTarjeta({ numero: num }, t.total);
                if (!r.ok) throw 0;
                ultimos4 = r.ultimos4;
            } catch (x) { $("btnPago").disabled = false; $("btnPago").textContent = "Reintentar pago"; return err("No se pudo procesar el pago. Intenta de nuevo."); }
        }
        const pedido = {
            id: "KL-" + Date.now().toString(36).toUpperCase(), email: sesion, fecha: Date.now(),
            items: carrito, ...t, cupon: t.desc || cupon === "ENVIOGRATIS" ? cupon : null,
            metodo: d.metodo, metodoTxt: METODOS[d.metodo] + (ultimos4 ? " ····" + ultimos4 : ""),
            estado: d.metodo === "tarjeta" ? "Pagado" : "Pendiente de pago",
            envioA: { nombre: d.nombre, tel: d.tel, dir: d.dir, cp: d.cp }
        };
        pedidos.push(pedido); guardar("kelu-pedidos", pedidos);
        carrito = []; cupon = null; render();
        confirmacion(pedido);
    });
}
$("pagar").addEventListener("click", checkout);

function mensajeWA(p) {
    const det = p.items.map(i => `• ${i.cantidad} x ${i.nombre} (${dinero(i.precio * i.cantidad)})`).join("\n");
    return `Hola, soy ${p.envioA.nombre}. Pedido ${p.id}:\n${det}\n\nCupón: ${p.cupon || "ninguno"}\nEnvío: ${p.envio ? dinero(p.envio) : "Gratis"}\nTotal: ${dinero(p.total)}\nMétodo: ${p.metodoTxt}\nEntrega: ${p.envioA.dir}, CP ${p.envioA.cp}. Tel: ${p.envioA.tel}`;
}
const linkWA = p => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(mensajeWA(p))}`;

function confirmacion(p) {
    let extra = "";
    if (p.metodo === "tarjeta") extra = "<p>Tu pago fue aprobado. Te avisaremos cuando salga tu envío.</p>";
    if (p.metodo === "spei") extra = `<p>Transfiere <strong>${dinero(p.total)}</strong> a:</p>
        <p class="ref">CLABE: ${CLABE}<br>${esc(BANCO)}<br>Concepto: ${p.id}</p>
        <p>Envíanos tu comprobante por WhatsApp para confirmar.</p>`;
    if (p.metodo === "oxxo") {
        const ref = String(Math.floor(Math.random() * 1e14)).padStart(14, "0").replace(/(.{4})/g, "$1 ").trim();
        extra = `<p>Paga <strong>${dinero(p.total)}</strong> en cualquier OXXO con esta referencia (vigente 48 h):</p>
        <p class="ref">${ref}</p><p>Envíanos tu comprobante por WhatsApp para confirmar.</p>`;
    }
    if (p.metodo === "whatsapp") extra = "<p>Envía tu pedido por WhatsApp y acordamos el pago y la entrega.</p>";
    abrirModal(`<h2>¡Pedido recibido!</h2><p>Número de pedido: <strong>${p.id}</strong></p>${extra}
        <a class="btn" target="_blank" rel="noopener" href="${linkWA(p)}">${p.metodo === "tarjeta" ? "Enviar resumen por WhatsApp" : "Enviar pedido por WhatsApp"}</a>`);
    if (p.metodo === "whatsapp") window.open(linkWA(p), "_blank");
}

render();