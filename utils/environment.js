// utils/environment.js
/**
 * Environment configuration validation and setup
 */

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET'
];

/**
 * Validate that all required environment variables are present
 * @returns {Object} Validation result
 */
function validateEnvironment() {
  const missing = [];
  const warnings = [];
  
  // Check required variables
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check for common configuration issues
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    warnings.push('JWT_SECRET should be at least 32 characters long for security');
  }

  if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL) {
    warnings.push('SUPABASE_URL not configured - authentication may not work properly');
  }

  if (process.env.ENABLE_CLOVER === 'true') {
    const cloverVars = ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN', 'CLOVER_BASE_URL'];
    const missingClover = cloverVars.filter(v => !process.env[v]);
    if (missingClover.length > 0) {
      warnings.push(`Clover is enabled but missing: ${missingClover.join(', ')}`);
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
    warnings,
    environment: process.env.NODE_ENV || 'development'
  };
}

/**
 * Get configuration object with defaults
 * @returns {Object} Configuration
 */
function getConfig() {
  return {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    database: {
      url: process.env.DATABASE_URL
    },
    jwt: {
      secret: process.env.JWT_SECRET
    },
    supabase: {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY
    },
    clover: {
      enabled: process.env.ENABLE_CLOVER === 'true',
      merchantId: process.env.CLOVER_MERCHANT_ID,
      accessToken: process.env.CLOVER_ACCESS_TOKEN,
      baseUrl: process.env.CLOVER_BASE_URL || 'https://sandbox.dev.clover.com'
    }
  };
}

/**
 * Initialize and validate environment on startup
 */
function initializeEnvironment() {
  const validation = validateEnvironment();
  const config = getConfig();

  console.log('🔧 Environment Configuration');
  console.log(`   Environment: ${validation.environment}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Database: ${config.database.url ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   JWT Secret: ${config.jwt.secret ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   Supabase: ${config.supabase.url ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log(`   Clover: ${config.clover.enabled ? '✅ Enabled' : '❌ Disabled'}`);

  if (validation.warnings.length > 0) {
    console.warn('⚠️  Configuration Warnings:');
    validation.warnings.forEach(warning => {
      console.warn(`   - ${warning}`);
    });
  }

  if (!validation.isValid) {
    console.error('❌ Missing Required Environment Variables:');
    validation.missing.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    
    if (validation.environment === 'production') {
      console.error('💥 Cannot start in production without required environment variables');
      process.exit(1);
    } else {
      console.warn('⚠️  Development mode: some features may not work without proper configuration');
    }
  }

  return { validation, config };
}

module.exports = {
  validateEnvironment,
  getConfig,
  initializeEnvironment
};