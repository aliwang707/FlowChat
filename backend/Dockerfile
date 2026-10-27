# 使用轻量级的 JDK 17 镜像
FROM eclipse-temurin:17-jre-alpine

# 设置工作目录
WORKDIR /app

# 把打好的 jar 包复制进去
COPY target/backend-0.0.1-SNAPSHOT.jar app.jar

# 暴露 8080 端口
EXPOSE 8080

# 启动命令
ENTRYPOINT ["java", "-jar", "app.jar"]