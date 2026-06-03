require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const jwt = require("jsonwebtoken");
const OpenAI = require("openai");
const verifyToken = require("./middleware/authMiddleware");
const app = express();

const multer = require("multer");
const path = require("path");

// 1. CREATE STORAGE FIRST
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

// 2. THEN CREATE UPLOAD
const upload = multer({ storage });

// 3. STATIC FOLDER
app.use("/uploads", express.static("uploads"));

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

app.post("/api/upload/profile", upload.single("image"), (req, res) => {
  try {
    const imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;

    db.query(
      "UPDATE profile SET image=? WHERE id=1",
      [imageUrl],
      (err) => {
        if (err) return res.status(500).json({ message: "DB update failed" });

        res.json({
          message: "Image uploaded successfully",
          image: imageUrl
        });
      }
    );
  } catch (err) {
    res.status(500).json({ message: "Upload failed" });
  }
});


// ===== OPENAI (OPTIONAL SAFE USAGE) =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== OFFLINE AI (FALLBACK) =====
function offlineAI(message) {
  const msg = message.toLowerCase();

  const rules = [
    {
      keywords: ["hello", "hi", "hey"],
      reply: "Hi 👋 I’m Frenki AI Assistant. How can I help you?"
    },
    {
      keywords: ["who are you", "about you"],
      reply: "I am a portfolio AI assistant built using Node.js + React."
    },
    {
      keywords: ["skills"],
      reply: "React, Node.js, MySQL, Express, Cloud Deployment."
    },
    {
      keywords: ["projects"],
      reply: "AI systems, e-commerce platforms, portfolio apps."
    },
    {
      keywords: ["contact"],
      reply: "Use contact form or WhatsApp button."
    }
  ];

  const match = rules.find(r =>
    r.keywords.some(k => msg.includes(k))
  );

  return match
    ? match.reply
    : "I’m still learning 🤖. Ask about skills, projects, or services.";
}

// ===== AI ROUTE (FIXED) =====
app.post("/api/ai", async (req, res) => {
  try {
    const message = req.body.message || "";

    // OPTION 1: TRY OPENAI IF KEY EXISTS
    if (process.env.OPENAI_API_KEY && process.env.USE_OPENAI === "true") {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a helpful portfolio assistant." },
            { role: "user", content: message }
          ]
        });

        return res.json({
          reply: response.choices[0].message.content
        });

      } catch (apiError) {
        console.log("OpenAI failed, switching to offline AI");
      }
    }

    // OPTION 2: OFFLINE AI ALWAYS WORKS
    return res.json({
      reply: offlineAI(message)
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({
      reply: "AI system error"
    });
  }
});


// ===== MYSQL CONNECTION (UNCHANGED) =====
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 60000
});

db.connect((err) => {
  if (err) {
    console.log("Database connection failed");
    console.log(err);
  } else {
    console.log("MySQL Connected Successfully");
  }
});

// ===== ADMIN LOGIN =====
app.post("/api/admin/login", (req, res) => {

  const { username, password } = req.body;

  const sql = `
    SELECT *
    FROM admins
    WHERE username = ?
  `;

  db.query(sql, [username], (err, results) => {

    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username"
      });
    }

    const admin = results[0];

    if (admin.password !== password) {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      success: true,
      token
    });

  });

});


app.put("/api/profile", (req, res) => {

  const { full_name, title, location, email, whatsapp } = req.body;

  const sql = `
    UPDATE profile
    SET full_name=?, title=?, location=?, email=?, whatsapp=?
    WHERE id=1
  `;

  db.query(sql,
    [full_name, title, location, email, whatsapp],
    (err) => {

      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Update failed" });
      }

      res.json({ message: "Profile updated successfully" });
    }
  );
});



// ===== DASHBOARD STATS =====
app.get("/api/dashboard/stats", (req, res) => {

  const stats = {};

  db.query(
    "SELECT COUNT(*) total FROM projects",
    (err, projects) => {

      stats.projects = projects[0].total;

      db.query(
        "SELECT COUNT(*) total FROM skills",
        (err, skills) => {

          stats.skills = skills[0].total;

          db.query(
            "SELECT COUNT(*) total FROM messages",
            (err, messages) => {

              stats.messages = messages[0].total;

              res.json(stats);

            }
          );
        }
      );
    }
  );

});



// ===== CONTACT ROUTE (UNCHANGED) =====
app.post("/api/contact", (req, res) => {
  const { name, email, message } = req.body;

  db.query(
    "INSERT INTO messages (name, email, message) VALUES (?, ?, ?)",
    [name, email, message],
    (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Failed to send" });
      }

      res.json({ message: "Message sent successfully" });
    }
  );
});


// ===== GET ALL PROJECTS =====
app.get("/api/projects", (req, res) => {
  const sql = "SELECT * FROM projects ORDER BY id DESC";

  db.query(sql, (err, results) => {
    if (err) {
      console.log(err);
      return res.status(500).json([]);
    }

    res.json(results);
  });
});


// ===== GET SINGLE PROJECT =====
app.get("/api/projects/:id", (req, res) => {

  const { id } = req.params;

  const sql = `
    SELECT *
    FROM projects
    WHERE id = ?
  `;

  db.query(sql, [id], (err, results) => {

    if (err) {
      console.log(err);

      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    res.status(200).json({
      success: true,
      data: results[0]
    });

  });

});


// ===== ADD PROJECT =====
app.post("/api/projects", (req, res) => {
  const { title, description, technologies } = req.body;

  if (!title || !description) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const sql =
    "INSERT INTO projects (title, description, technologies) VALUES (?, ?, ?)";

  db.query(sql, [title, description, technologies], (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "DB error" });
    }

    // 🔥 IMPORTANT FIX
    res.json({
      id: result.insertId,
      title,
      description,
      technologies
    });
  });
});
// ===== UPDATE PROJECT =====
app.put("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const { title, description, technologies } = req.body;

  const sql =
    "UPDATE projects SET title=?, description=?, technologies=? WHERE id=?";

  db.query(sql, [title, description, technologies, id], (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Update failed" });
    }

    res.json({ message: "Project updated" });
  });
});


// ===== DELETE PROJECT =====
app.delete("/api/projects/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM projects WHERE id=?";

  db.query(sql, [id], (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete failed" });
    }

    res.json({ message: "Project deleted" });
  });
});

app.get("/api/profile", (req, res) => {

  const sql = `
    SELECT *
    FROM profile
    LIMIT 1
  `;

  db.query(sql, (err, results) => {

    if (err) {
      return res.status(500).json({
        message: "Database error"
      });
    }

    res.json(results[0]);

  });

});


app.get("/api/about", (req, res) => {
  db.query("SELECT * FROM about ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});

app.post("/api/about", (req, res) => {
  const { title, description } = req.body;

  db.query(
    "INSERT INTO about (title, description) VALUES (?, ?)",
    [title, description],
    (err, result) => {
      if (err) return res.status(500).json({ message: "Error" });

      res.json({
        id: result.insertId,
        title,
        description,
      });
    }
  );
});

app.put("/api/about/:id", (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;

  db.query(
    "UPDATE about SET title=?, description=? WHERE id=?",
    [title, description, id],
    (err) => {
      if (err) return res.status(500).json({ message: "Error" });

      res.json({ message: "Updated" });
    }
  );
});


app.delete("/api/about/:id", (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM about WHERE id=?", [id], (err) => {
    if (err) return res.status(500).json({ message: "Error" });

    res.json({ message: "Deleted" });
  });
});


// =========================
// SKILLS MODULE (NO SEPARATE FILE)
// =========================

// GET ALL SKILLS
app.get("/api/skills", (req, res) => {
  db.query(
    "SELECT * FROM skills ORDER BY id DESC",
    (err, results) => {
      if (err) {
        console.log("GET skills error:", err);
        return res.status(500).json([]);
      }
      res.json(results);
    }
  );
});


// CREATE SKILL
app.post("/api/skills", (req, res) => {
  const { skill_name } = req.body;

  if (!skill_name) {
    return res.status(400).json({ message: "Skill name required" });
  }

  db.query(
    "INSERT INTO skills (skill_name) VALUES (?)",
    [skill_name],
    (err, result) => {
      if (err) {
        console.log("POST skills error:", err);
        return res.status(500).json(err);
      }

      res.json({
        id: result.insertId,
        skill_name
      });
    }
  );
});


// DELETE SKILL
app.delete("/api/skills/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    "DELETE FROM skills WHERE id = ?",
    [id],
    (err) => {
      if (err) {
        console.log("DELETE skills error:", err);
        return res.status(500).json(err);
      }

      res.json({ message: "Skill deleted successfully" });
    }
  );
});


app.get("/api/profile", (req, res) => {

  db.query(
    "SELECT * FROM profile LIMIT 1",
    (err, results) => {

      if (err) {
        return res.status(500).json({});
      }

      res.json(results[0]);
    }
  );

});


// ===== START SERVER =====
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});