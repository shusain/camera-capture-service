# Backend build stage (optional)
FROM node:18 AS backend-build
WORKDIR /usr/src/app/backend
COPY ./ ./
RUN npm install

# Backend run stage
FROM node:18 AS backend-serve
WORKDIR /usr/src/app/backend
COPY --from=backend-build /usr/src/app/backend /usr/src/app/backend
CMD ["npm", "start"]
EXPOSE 3000
