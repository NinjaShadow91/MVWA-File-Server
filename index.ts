import { PrismaClient } from "@prisma/client";
import http from "http";
import formidable from "formidable";
import fs from "fs";
import { pbkdf2Sync, randomUUID } from "crypto";
import Url from "url";
import tus from "tus-node-server";

const prisma = new PrismaClient();
const ITERATIONS = 10;
const base = "./images";

async function handleUpload(req: http.IncomingMessage) {
  const token = Url.parse(req.url ?? "", true).query.token;
  if (token && typeof token === "string") {
    const derivedToken = pbkdf2Sync(
      token,
      "",
      ITERATIONS,
      64,
      "sha512"
    ).toString("hex");

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

      return url;
    }
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
        const file = fs.createReadStream(base.concat(media.url));
        res.setHeader("Content-Type", media.Type.name);
        file.pipe(res);
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

const tusServer = new tus.Server({
  path: "./files",
  // namingFunction: handleUpload,
});
tusServer.datastore = new tus.FileStore({ directory: "./files" });

tusServer.on("EVENT_FILE_CREATED", async (file, req) => {
  console.log("check2");
  await handleUpload(req);
});

tusServer.on("EVENT_ENDPOINT_CREATED", () => {
  console.log("check3");
});

http
  .createServer(async function (req, res) {
    console.log("req", Date(), req.url, req.headers);

    if (req.url?.startsWith("/fileUpload")) {
      // const token = Url.parse(req.url ?? "", true).query.token;
      const tokenHeader = req.headers["access-control-request-headers"]
        ?.split(",")
        .filter((h) => h.startsWith("token"))[0];
      const token = tokenHeader?.substring(5);
      if (token && typeof token === "string") {
        const derivedToken = pbkdf2Sync(
          token,
          "",
          ITERATIONS,
          64,
          "sha512"
        ).toString("hex");
        console.log("req", Date(), derivedToken);

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
          console.log("ech");
          return tusServer.handle(req, res);
        } else {
          res.setHeader("Content-Type", "application/json");
          res.write(JSON.stringify({ sucess: false, message: "Unauthorized" }));
          res.end();
          return;
        }
      } else {
        res.setHeader("Content-Type", "application/json");
        res.write(JSON.stringify({ sucess: false, message: "Bad Request" }));
        res.end();
        return;
      }
    } else if (req.url?.startsWith("/fileRetrieve")) {
      await handleRetrieve(req, res);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(
        '<form action="fileupload" method="post" enctype="multipart/form-data">'
      );
      res.write('<input type="file" name="filetoupload"><br>');
      res.write('<input type="submit">');
      res.write("</form>");
      return res.end();
    }
  })
  .listen(8080);
