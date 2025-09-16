/**
 * Simple migration runner utility
 * 
 * Usage:
 *   node migrations/run-migrations.js
 * 
 * This script runs all SQL files in the migrations directory in alphabetical order
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  console.log('Starting migrations...');
  
  try {
    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Run in alphabetical order
    
    if (files.length === 0) {
      console.log('No migration files found');
      return;
    }
    
    console.log(`Found ${files.length} migration files:`, files);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const file of files) {
        console.log(`Running migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        // Execute the migration
        await client.query(sql);
        console.log(`✓ Completed: ${file}`);
      }
      
      await client.query('COMMIT');
      console.log('All migrations completed successfully!');
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Migration failed, rolling back:', error.message);
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Migration error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };