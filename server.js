// API Node.js para Sistema Multi-tenant
// Deploy en Render.com

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Inicializar Firebase Admin
// En Render, configurar variable de entorno FIREBASE_CONFIG con el JSON de credenciales
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG || '{}');

if (Object.keys(serviceAccount).length > 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  console.log('⚠️  Firebase no configurado. Usar variable FIREBASE_CONFIG');
}

const db = admin.firestore();

// ============================================
// UTILIDADES
// ============================================

function generarUser(nombreNegocio) {
  const base = nombreNegocio
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 20);
  const year = new Date().getFullYear();
  return `${base}-${year}`;
}

function generarPIN() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generarNegocioID() {
  return 'neg_' + crypto.randomBytes(8).toString('hex');
}

// ============================================
// SUPER ADMIN - Gestión de Negocios
// ============================================

// Crear nuevo negocio
app.post('/api/super-admin/negocios', async (req, res) => {
  try {
    const { nombreNegocio, email, superAdminKey } = req.body;

    // Validar super admin key
    if (superAdminKey !== process.env.SUPER_ADMIN_KEY) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const negocioID = generarNegocioID();
    const user = generarUser(nombreNegocio);
    const pin = generarPIN();

    const negocioData = {
      negocioID,
      user,
      pin,
      nombreNegocio,
      email,
      activo: true,
      briefCompletado: false,
      fechaCreacion: admin.firestore.FieldValue.serverTimestamp(),
      config: {
        nombre: nombreNegocio,
        colores: {
          primario: '#3B82F6',
          secundario: '#10B981'
        },
        contacto: {
          email,
          telefono: '',
          whatsapp: '',
          direccion: '',
          redesSociales: {}
        }
      }
    };

    await db.collection('negocios').doc(negocioID).set(negocioData);

    res.json({
      success: true,
      negocio: {
        negocioID,
        user,
        pin,
        nombreNegocio,
        email
      }
    });
  } catch (error) {
    console.error('Error creando negocio:', error);
    res.status(500).json({ error: error.message });
  }
});

// Listar todos los negocios
app.get('/api/super-admin/negocios', async (req, res) => {
  try {
    const { superAdminKey } = req.query;

    if (superAdminKey !== process.env.SUPER_ADMIN_KEY) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const snapshot = await db.collection('negocios').get();
    const negocios = [];

    snapshot.forEach(doc => {
      negocios.push({ id: doc.id, ...doc.data() });
    });

    res.json({ negocios });
  } catch (error) {
    console.error('Error listando negocios:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AUTENTICACIÓN
// ============================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { user, pin } = req.body;

    const snapshot = await db.collection('negocios')
      .where('user', '==', user)
      .where('pin', '==', pin)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const negocio = snapshot.docs[0].data();

    if (!negocio.activo) {
      return res.status(403).json({ error: 'Negocio inactivo' });
    }

    res.json({
      success: true,
      negocioID: negocio.negocioID,
      nombreNegocio: negocio.nombreNegocio,
      briefCompletado: negocio.briefCompletado
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BRIEF - Formulario inicial
// ============================================

app.post('/api/:negocioID/brief', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const briefData = req.body;

    const negocioRef = db.collection('negocios').doc(negocioID);
    const negocio = await negocioRef.get();

    if (!negocio.exists) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    await negocioRef.update({
      briefCompletado: true,
      config: {
        ...negocio.data().config,
        ...briefData.config
      }
    });

    // Guardar productos iniciales
    if (briefData.productosIniciales && briefData.productosIniciales.length > 0) {
      const batch = db.batch();
      briefData.productosIniciales.forEach(producto => {
        const productoRef = db.collection('negocios').doc(negocioID)
          .collection('productos').doc();
        batch.set(productoRef, {
          ...producto,
          activo: true,
          fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error guardando brief:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CONFIG - Obtener configuración del negocio
// ============================================

app.get('/api/:negocioID/config', async (req, res) => {
  try {
    const { negocioID } = req.params;

    const negocio = await db.collection('negocios').doc(negocioID).get();

    if (!negocio.exists) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json(negocio.data().config);
  } catch (error) {
    console.error('Error obteniendo config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar configuración
app.put('/api/:negocioID/config', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const updates = req.body;

    await db.collection('negocios').doc(negocioID).update({
      'config': updates
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PRODUCTOS
// ============================================

// Listar productos
app.get('/api/:negocioID/productos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const { soloActivos } = req.query;

    let query = db.collection('negocios').doc(negocioID).collection('productos');

    if (soloActivos === 'true') {
      query = query.where('activo', '==', true);
    }

    const snapshot = await query.get();
    const productos = [];

    snapshot.forEach(doc => {
      productos.push({ id: doc.id, ...doc.data() });
    });

    res.json({ productos });
  } catch (error) {
    console.error('Error listando productos:', error);
    res.status(500).json({ error: error.message });
  }
});

// Crear producto
app.post('/api/:negocioID/productos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const producto = req.body;

    const docRef = await db.collection('negocios').doc(negocioID)
      .collection('productos').add({
        ...producto,
        activo: true,
        fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
      });

    res.json({ success: true, productoID: docRef.id });
  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar producto
app.put('/api/:negocioID/productos/:productoID', async (req, res) => {
  try {
    const { negocioID, productoID } = req.params;
    const updates = req.body;

    await db.collection('negocios').doc(negocioID)
      .collection('productos').doc(productoID).update(updates);

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar producto
app.delete('/api/:negocioID/productos/:productoID', async (req, res) => {
  try {
    const { negocioID, productoID } = req.params;

    await db.collection('negocios').doc(negocioID)
      .collection('productos').doc(productoID).delete();

    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PEDIDOS
// ============================================

// Crear pedido (desde sitio público)
app.post('/api/:negocioID/pedidos', async (req, res) => {
  try {
    const { negocioID } = req.params;
    const pedido = req.body;

    const docRef = await db.collection('negocios').doc(negocioID)
      .collection('pedidos').add({
        ...pedido,
        estado: 'pendiente',
        fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
      });

    res.json({ success: true, pedidoID: docRef.id });
  } catch (error) {
    console.error('Error creando pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

// Listar pedidos
app.get('/api/:negocioID/pedidos', async (req, res) => {
  try {
    const { negocioID } = req.params;

    const snapshot = await db.collection('negocios').doc(negocioID)
      .collection('pedidos')
      .orderBy('fechaCreacion', 'desc')
      .get();

    const pedidos = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      pedidos.push({
        id: doc.id,
        ...data,
        fechaCreacion: data.fechaCreacion?.toDate()
      });
    });

    res.json({ pedidos });
  } catch (error) {
    console.error('Error listando pedidos:', error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar estado de pedido
app.put('/api/:negocioID/pedidos/:pedidoID', async (req, res) => {
  try {
    const { negocioID, pedidoID } = req.params;
    const { estado } = req.body;

    await db.collection('negocios').doc(negocioID)
      .collection('pedidos').doc(pedidoID).update({ estado });

    res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// IA - Generación de contenido
// ============================================

app.post('/api/ia/generar-texto', async (req, res) => {
  try {
    const { prompt, tipo } = req.body;

    // Aquí integrarías OpenAI o Claude API
    // Por ahora, respuesta mock
    let textoGenerado = '';

    switch(tipo) {
      case 'sobre-nosotros':
        textoGenerado = `Somos una empresa dedicada a brindar los mejores productos y servicios. Con años de experiencia en el mercado, nos caracterizamos por nuestra calidad y atención al cliente.`;
        break;
      case 'mision':
        textoGenerado = `Nuestra misión es ofrecer productos de la más alta calidad, superando las expectativas de nuestros clientes y contribuyendo al desarrollo de nuestra comunidad.`;
        break;
      case 'vision':
        textoGenerado = `Ser líderes en nuestro sector, reconocidos por nuestra innovación, compromiso y excelencia en el servicio.`;
        break;
      default:
        textoGenerado = prompt;
    }

    res.json({ texto: textoGenerado });
  } catch (error) {
    console.error('Error generando texto:', error);
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
    message: 'API Multi-tenant funcionando',
    version: '1.0.0',
    endpoints: [
      'POST /api/super-admin/negocios',
      'GET /api/super-admin/negocios',
      'POST /api/auth/login',
      'POST /api/:negocioID/brief',
      'GET /api/:negocioID/config',
      'GET /api/:negocioID/productos',
      'POST /api/:negocioID/productos',
      'GET /api/:negocioID/pedidos',
      'POST /api/:negocioID/pedidos'
    ]
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
});