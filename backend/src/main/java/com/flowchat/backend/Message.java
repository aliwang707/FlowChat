package com.flowchat.backend;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data // Lombok 自动生成 getter/setter
@TableName("message") // 对应数据库表名

public class Message {
    private Long id;
    private Integer sessionId;
    private String content;
}
