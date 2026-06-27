function generarFolio(id_venta) {
    const fecha = new Date();
    const yy  = String(fecha.getFullYear()).slice(-2);
    const mm  = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd  = String(fecha.getDate()).padStart(2, '0');
    return `ECO-${yy}${mm}${dd}-${String(id_venta).padStart(5, '0')}`;
}

module.exports = { generarFolio };