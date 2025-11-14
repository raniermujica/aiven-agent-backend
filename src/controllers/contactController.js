import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendContactForm(req, res) {
  try {
    const { name, phone, email, businessType } = req.body;

    if (!name || !phone || !email || !businessType) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    const msg = {
      to: 'ranieremujica@gmail.com',
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: '🎯 Nuevo contacto desde Demo - Agent Paul',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ec4899;">📋 Nuevo Contacto desde la Demo</h2>
          
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>👤 Nombre:</strong> ${name}</p>
            <p><strong>📧 Email:</strong> ${email}</p>
            <p><strong>📱 Teléfono:</strong> ${phone}</p>
            <p><strong>🏢 Tipo de negocio:</strong> ${businessType}</p>
          </div>

          <p style="color: #6b7280; font-size: 14px;">
            Este contacto solicitó información sobre la prueba gratuita de 7 días.
          </p>
        </div>
      `
    };

    await sgMail.send(msg);

    res.json({ 
      success: true, 
      message: 'Formulario enviado correctamente' 
    });

  } catch (error) {
    console.error('Error enviando email:', error);
    res.status(500).json({ error: 'Error al enviar el formulario' });
  }
};