package com.flowchat.backend;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CrossOrigin // 允许前端跨域访问
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    @Autowired
    private MessageMapper messageMapper; // 注入数据库操作

    @GetMapping("/history")
    public Map<String, Object> getHistory(@RequestParam Integer sessionId){
        Map<String, Object> response = new HashMap<>();

        // 使用 MyBatis-Plus 查询：select * from message where session_id = ?
        QueryWrapper<Message> query = new QueryWrapper<>();
        query.eq("session_id", sessionId);
        List<Message> messages = messageMapper.selectList(query);

        response.put("code", 200);
        response.put("msg", "success");
        response.put("data", messages);
        return response;
    }
}