.
├── app.js                   # Application entry point and middleware configuration
├── config/                  # Database and app configuration files
├── middleware/              # Auth, CSRF, flash messaging, and custom middleware
├── public/                  # Static assets (images, uploaded files, CSS, JS)
├── routes/                  # Express route handlers
│   ├── adminRoutes.js       # Admin panel endpoints
│   ├── dashboardRoutes.js   # User dashboard endpoints
│   ├── disasterRoutes.js    # Relief campaign/disaster management
│   ├── donationRoutes.js    # Donation flow & tracking
│   └── userRoutes.js        # Authentication & profile routes
├── scripts/                 # Utility scripts (database initialization, admin creation)
│   ├── createAdmin.js
│   └── initDb.js
├── services/                # External services (Payment handling, Mailer)
├── utils/                   # Helper functions and formatting utilities
└── views/                   # EJS templates for front-end rendering
