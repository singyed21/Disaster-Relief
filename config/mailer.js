// config/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true for 465, false for other ports like 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendVerificationCode = async (toEmail, verificationCode) => {
  const mailOptions = {
    from: `"Disaster Relief Portal" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Verification Code - Disaster Relief Portal',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2c3e50; text-align: center;">Disaster Relief Portal</h2>
        <p>Hello,</p>
        <p>Use the verification code below to verify your account or complete your action:</p>
        <div style="text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #e74c3c; background-color: #f9f9f9; padding: 10px 20px; border-radius: 5px; border: 1px dashed #e74c3c; display: inline-block;">
            ${verificationCode}
          </span>
        </div>
        <p style="color: #7f8c8d; font-size: 14px;">This code will expire in <strong>10 minutes</strong>.</p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};

module.exports = { sendVerificationCode };