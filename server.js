const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Leer credenciales de Firebase desde archivo secreto o variable de entorno
let serviceAccount;
const secretPath = '/etc/secrets/serviceAccountKey.json';

try {
  if (fs.existsSync(secretPath)) {
    // Leer desde archivo secreto de Render
    console.log('Leyendo credenciales desde archivo secreto...');
    const fileContent = fs.readFileSync(secretPath, 'utf8');
    serviceAccount = JSON.parse(fileContent);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Fallback a variable de entorno
    console.log('Leyendo credenciales desde variable de entorno...');
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    throw new Error('No se encontraron credenciales de Firebase');
  }
} catch (error) {
  console.error('ERROR cargando credenciales de Firebase:', error.message);
  process.exit(1);
}

// Extraer storageBucket del serviceAccount
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 
                      serviceAccount.project_id + '.appspot.com';

console.log('Inicializando Firebase...');
console.log('Project ID:', serviceAccount.project_id);
console.log('Storage bucket:', storageBucket);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: storageBucket
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ============================================
// UPLOAD DE IMÁGENES
// ============================================
app.post('/api/:negocioID/upload-imagen', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const { imagen, nombre } = req.body; // imagen en base64

    if (!imagen) {
      return res.status(400).json({ error: 'No se proporcionó imagen' });
    }

    // Convertir base64 a buffer
    const base64Data = imagen.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generar nombre único
    const timestamp = Date.now();
    const extension = imagen.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpg';
    const fileName = `${negocioID}/${timestamp}-${nombre || 'imagen'}.${extension}`;

    // Subir a Firebase Storage
    const file = bucket.file(fileName);
    await file.save(buffer, {
      metadata: {
        contentType: `image/${extension}`,
        metadata: {
          negocioID: negocioID
        }
      },
      public: true
    });

    // Obtener URL pública
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    res.json({ 
      success: true, 
      url: publicUrl,
      fileName: fileName 
    });
  } catch (error) {
    console.error('Error subiendo imagen:', error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar imagen
app.delete('/api/:negocioID/delete-imagen', async (req, res) => {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'No se proporcionó nombre de archivo' });
    }

    await bucket.file(fileName).delete();

    res.json({ success: true, message: 'Imagen eliminada' });
  } catch (error) {
    console.error('Error eliminando imagen:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AUTENTICACIÓN
// ============================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { user, pin, negocioID } = req.body;

    if (!user || !pin || !negocioID) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    const negocioRef = db.collection('negocios').doc(negocioID);
    const negocioDoc = await negocioRef.get();

    if (!negocioDoc.exists) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const negocioData = negocioDoc.data();

    if (negocioData.admin?.user === user && negocioData.admin?.pin === pin) {
      return res.json({
        success: true,
        negocioID: negocioID,
        nombre: negocioData.nombre
      });
    }

    res.status(401).json({ error: 'Credenciales inválidas para este negocio' });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CONFIGURACIÓN
// ============================================
app.get('/api/:negocioID/config', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const negocioDoc = await db.collection('negocios').doc(negocioID).get();

    if (!negocioDoc.exists) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json(negocioDoc.data());
  } catch (error) {
    console.error('Error obteniendo config:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/config', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const datos = req.body;

    await db.collection('negocios').doc(negocioID).update({
      ...datos,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Configuración actualizada' });
  } catch (error) {
    console.error('Error actualizando config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SECCIONES ACTIVAS
// ============================================
app.get('/api/:negocioID/secciones', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const negocioDoc = await db.collection('negocios').doc(negocioID).get();

    if (!negocioDoc.exists) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const data = negocioDoc.data();
    res.json({
      secciones: data.seccionesActivas || {
        hero: true,
        servicios: true,
        nosotros: true,
        casosExito: true,
        testimonios: true,
        galeria: true,
        contacto: true
      }
    });
  } catch (error) {
    console.error('Error obteniendo secciones:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/secciones', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const { secciones } = req.body;

    await db.collection('negocios').doc(negocioID).update({
      seccionesActivas: secciones,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Secciones actualizadas' });
  } catch (error) {
    console.error('Error actualizando secciones:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PRODUCTOS
// ============================================
app.get('/api/:negocioID/productos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const productosRef = db.collection('negocios').doc(negocioID).collection('productos');
    const snapshot = await productosRef.where('activo', '==', true).get();

    const productos = [];
    snapshot.forEach(doc => {
      productos.push({ id: doc.id, ...doc.data() });
    });

    res.json({ productos });
  } catch (error) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:negocioID/productos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const producto = req.body;

    const docRef = await db.collection('negocios').doc(negocioID).collection('productos').add({
      ...producto,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/productos/:productoID', async (req, res) => {
  try {
    const { negocioID, productoID } = req.params;
    const datos = req.body;

    await db.collection('negocios').doc(negocioID).collection('productos').doc(productoID).update({
      ...datos,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/:negocioID/productos/:productoID', async (req, res) => {
  try {
    const { negocioID, productoID } = req.params;
    await db.collection('negocios').doc(negocioID).collection('productos').doc(productoID).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SERVICIOS
// ============================================
app.get('/api/:negocioID/servicios', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const serviciosRef = db.collection('negocios').doc(negocioID).collection('servicios');
    const snapshot = await serviciosRef.orderBy('orden', 'asc').get();

    const servicios = [];
    snapshot.forEach(doc => {
      servicios.push({ id: doc.id, ...doc.data() });
    });

    res.json({ servicios });
  } catch (error) {
    console.error('Error obteniendo servicios:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:negocioID/servicios', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const servicio = req.body;

    const docRef = await db.collection('negocios').doc(negocioID).collection('servicios').add({
      ...servicio,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creando servicio:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/servicios/:servicioID', async (req, res) => {
  try {
    const { negocioID, servicioID } = req.params;
    const datos = req.body;

    await db.collection('negocios').doc(negocioID).collection('servicios').doc(servicioID).update({
      ...datos,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando servicio:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/:negocioID/servicios/:servicioID', async (req, res) => {
  try {
    const { negocioID, servicioID } = req.params;
    await db.collection('negocios').doc(negocioID).collection('servicios').doc(servicioID).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando servicio:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TESTIMONIOS
// ============================================
app.get('/api/:negocioID/testimonios', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const testimoniosRef = db.collection('negocios').doc(negocioID).collection('testimonios');
    const snapshot = await testimoniosRef.orderBy('orden', 'asc').get();

    const testimonios = [];
    snapshot.forEach(doc => {
      testimonios.push({ id: doc.id, ...doc.data() });
    });

    res.json({ testimonios });
  } catch (error) {
    console.error('Error obteniendo testimonios:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:negocioID/testimonios', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const testimonio = req.body;

    const docRef = await db.collection('negocios').doc(negocioID).collection('testimonios').add({
      ...testimonio,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creando testimonio:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/testimonios/:testimonioID', async (req, res) => {
  try {
    const { negocioID, testimonioID } = req.params;
    const datos = req.body;

    await db.collection('negocios').doc(negocioID).collection('testimonios').doc(testimonioID).update({
      ...datos,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando testimonio:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/:negocioID/testimonios/:testimonioID', async (req, res) => {
  try {
    const { negocioID, testimonioID } = req.params;
    await db.collection('negocios').doc(negocioID).collection('testimonios').doc(testimonioID).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando testimonio:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CASOS DE ÉXITO
// ============================================
app.get('/api/:negocioID/casos-exito', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const casosRef = db.collection('negocios').doc(negocioID).collection('casosExito');
    const snapshot = await casosRef.orderBy('orden', 'asc').get();

    const casos = [];
    snapshot.forEach(doc => {
      casos.push({ id: doc.id, ...doc.data() });
    });

    res.json({ casos });
  } catch (error) {
    console.error('Error obteniendo casos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:negocioID/casos-exito', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const caso = req.body;

    const docRef = await db.collection('negocios').doc(negocioID).collection('casosExito').add({
      ...caso,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creando caso:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/casos-exito/:casoID', async (req, res) => {
  try {
    const { negocioID, casoID } = req.params;
    const datos = req.body;

    await db.collection('negocios').doc(negocioID).collection('casosExito').doc(casoID).update({
      ...datos,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando caso:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/:negocioID/casos-exito/:casoID', async (req, res) => {
  try {
    const { negocioID, casoID } = req.params;
    await db.collection('negocios').doc(negocioID).collection('casosExito').doc(casoID).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando caso:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GALERÍA
// ============================================
app.get('/api/:negocioID/galeria', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const galeriaRef = db.collection('negocios').doc(negocioID).collection('galeria');
    const snapshot = await galeriaRef.orderBy('orden', 'asc').get();

    const imagenes = [];
    snapshot.forEach(doc => {
      imagenes.push({ id: doc.id, ...doc.data() });
    });

    res.json({ imagenes });
  } catch (error) {
    console.error('Error obteniendo galería:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:negocioID/galeria', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const imagen = req.body;

    const docRef = await db.collection('negocios').doc(negocioID).collection('galeria').add({
      ...imagen,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error agregando imagen:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/:negocioID/galeria/:imagenID', async (req, res) => {
  try {
    const { negocioID, imagenID } = req.params;
    await db.collection('negocios').doc(negocioID).collection('galeria').doc(imagenID).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando imagen:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PEDIDOS
// ============================================
app.get('/api/:negocioID/pedidos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const pedidosRef = db.collection('negocios').doc(negocioID).collection('pedidos');
    const snapshot = await pedidosRef.orderBy('fechaCreacion', 'desc').get();

    const pedidos = [];
    snapshot.forEach(doc => {
      pedidos.push({ id: doc.id, ...doc.data() });
    });

    res.json({ pedidos });
  } catch (error) {
    console.error('Error obteniendo pedidos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:negocioID/pedidos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const pedido = req.body;

    const docRef = await db.collection('negocios').doc(negocioID).collection('pedidos').add({
      ...pedido,
      estado: 'pendiente',
      fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creando pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:negocioID/pedidos/:pedidoID', async (req, res) => {
  try {
    const { negocioID, pedidoID } = req.params;
    const { estado } = req.body;

    await db.collection('negocios').doc(negocioID).collection('pedidos').doc(pedidoID).update({
      estado,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    message: 'API Multi-tenant con sistema modular',
    version: '2.0.0',
    endpoints: [
      'POST /api/auth/login',
      'GET /api/:negocioID/config',
      'PUT /api/:negocioID/config',
      'GET /api/:negocioID/secciones',
      'PUT /api/:negocioID/secciones',
      'CRUD /api/:negocioID/productos',
      'CRUD /api/:negocioID/servicios',
      'CRUD /api/:negocioID/testimonios',
      'CRUD /api/:negocioID/casos-exito',
      'CRUD /api/:negocioID/galeria',
      'CRUD /api/:negocioID/pedidos'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API modular corriendo en puerto ${PORT}`);
});