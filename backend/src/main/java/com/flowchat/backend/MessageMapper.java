package com.flowchat.backend;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface MessageMapper extends BaseMapper<Message> {
    // 继承 BaseMapper 后，自动拥有了 CRUD 方法，不用写 SQL
}
