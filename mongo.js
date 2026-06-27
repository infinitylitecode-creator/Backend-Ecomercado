require('dotenv').config();
const { MongoClient } = require('mongodb');
const dns = require('dns');

// Forzar Google DNS para resolver hostnames SRV de Atlas
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS:         8000,
});

let db = null;

async function conectarMongo() {
    if (db) return db;
    await client.connect();
    db = client.db('ecomercado_nosql');
    console.log('✅ Conectado a MongoDB Atlas (ecomercado_nosql)');
    return db;
}

async function getReportesCol() {
    const database = await conectarMongo();
    return database.collection('reportes');
}

module.exports = { conectarMongo, getReportesCol };