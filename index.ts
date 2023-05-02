import { PrismaClient } from "@prisma/client";
import http from "http";
import formidable from "formidable";
import fs from "fs";
import { pbkdf2Sync, randomUUID } from "crypto";
import Url from "url";
import tus from "tus-node-server";

import express from "express";
import fileUpload from "express-fileupload";
import cors from "cors";
import bodyParser from "body-parser";
import morgan from "morgan";

const prisma = new PrismaClient();
const ITERATIONS = 10;
const base = "/home/college/Ninja/Trying../New/Code/Web/mvwaFileServer/images/";

async function handleUpload(token: string) {
  if (!token) return;
  const derivedToken = pbkdf2Sync(token, "", ITERATIONS, 64, "sha512").toString(
    "hex"
  );

  const verificationToken = await prisma.verificationToken.findUnique({
    where: {
      token: derivedToken,
    },
  });

  if (
    verificationToken &&
    verificationToken.type === "IMAGE_OPERATION" &&
    verificationToken.expires > new Date()
  ) {
    const url = base.concat(randomUUID());
    await prisma.$transaction([
      prisma.media.update({
        where: {
          mediaId: verificationToken.identifier,
        },
        data: {
          url: url,
          Type: {
            connect: {
              name: "image/jpeg",
            },
          },
        },
      }),
      prisma.verificationToken.update({
        where: {
          token: derivedToken,
        },
        data: {
          type: "IMAGE_OPERATION_USED",
        },
      }),
    ]);

    return { url, mediaId: verificationToken.identifier };
  }
}

async function handleRetrieve(
  req: http.IncomingMessage,
  res: http.ServerResponse<http.IncomingMessage> & {
    req: http.IncomingMessage;
  }
) {
  try {
    const token = Url.parse(req.url ?? "", true).query.token;
    if (token && typeof token === "string") {
      const media = await prisma.media.findUnique({
        where: {
          mediaId: token,
        },
        select: {
          mediaId: true,
          url: true,
          Type: {
            select: {
              name: true,
            },
          },
        },
      });
      if (media) {
        let filePath = "";
        if (media.url.startsWith(base)) filePath = media.url;
        else if (media.url.startsWith("/"))
          filePath = base.concat(media.url.substring(1));
        else
          filePath = base.concat(
            media.url.split("/")[media.url.split("/").length - 1]
          );
        const file = fs.createReadStream(filePath);
        res.setHeader("Content-Type", media.Type.name);
        file.pipe(res);
        file.on("error", (err) => {
          res.setHeader("Content-Type", "application/json");
          res.write(
            JSON.stringify({ sucess: false, message: "Something went bad" })
          );
          res.end();
        });
      } else {
        res.write(JSON.stringify({ sucess: false, message: "NOT FOUND" }));
        res.end();
        return;
      }
    } else {
      res.setHeader("Content-Type", "application/json");
      res.write(JSON.stringify({ sucess: false, message: "BAD REQUEST" }));
      res.end();
      return;
    }
  } catch (e) {
    console.log(e);
    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify({ sucess: false, message: "Something went bad" }));
    res.end();
    return;
  }
}

const app = express();

app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan("dev"));

const port = process.env.PORT || 8080;

app.listen(port, () => console.log(`App is listening on port ${port}.`));

app.post("/fileUpload/", async (req, res) => {
  try {
    console.log(req.body);
    if (!req.files) {
      res.send({
        status: false,
        message: "No file uploaded",
      });
      res.end();
      return;
    } else {
      let data: {
        name: string;
        mimetype: string;
        size: number;
        mediaId: String;
      }[] = [];

      if (!Array.isArray(req.files.file)) {
        const url = await handleUpload(req.body.token);
        if (url) {
          req.files.file.mv(url.url);
          data.push({
            name: req.files.file.name,
            mimetype: req.files.file.mimetype,
            size: req.files.file.size,
            mediaId: url.mediaId,
          });
        } else {
          // console.log("UNAUTHORIZED");
          res.status(403).send({ sucess: false, message: "BAD REQUEST" });
          res.end();
          return;
        }
        res.send({
          status: true,
          message: "Files are uploaded",
          data: data,
        });
      } else {
        //loop all files
        req.files.file.forEach(async (file) => {
          // implement
        });

        //return response
        res.send({
          status: true,
          message: "Files are uploaded",
          data: data,
        });
      }
    }
  } catch (err) {
    console.log(err);
    res.status(500).send(err);
  }
});

app.get("/fileRetrieve/", async (req, res) => {
  handleRetrieve(req, res);
});
